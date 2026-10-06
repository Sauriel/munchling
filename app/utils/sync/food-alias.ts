import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { aggregatePayload } from "../database/outbox";
import { snapshotBackup } from "../database/backup";
import { cloneBackup, type MunchlingBackup } from "../../../shared/domain/backup";
import type { ServerAggregate, ServerOperation } from "../../../shared/domain/server";
import type { SnapshotPage } from "../../../shared/domain/protocol";
import { completeSnapshot, type CompleteSnapshot } from "../../../shared/domain/snapshot";
import { createUuid } from "../../../shared/domain/sync";
import { normalizeWriteBatch } from "../../../shared/domain/server-validation";
import { SyncClientError } from "../../../shared/domain/replies";
import { meta, preflight, referenceIds, writeRoots } from "./apply";
import { checkProof, digest, localDigest, remoteDigest, uncertain } from "./decisions";
import { receiveState, storedJson } from "./staging";

type Queued = { batch_id: string; entity_uuid: string; base_revision: number; payload: string };
export type FoodAliasReview = {
	token: string; localEpoch: string; url: string; sourceId: string; targetId: string;
	source: Record<string, unknown>; target: ServerAggregate; ingredientCount: number; mealCount: number;
	companions: { id: string; entity: string; name: string }[];
};
async function context(sql: SqlExecutor, snapshot: CompleteSnapshot) {
	const state = await receiveState(sql);
	if (!state.url || state.cursor === null) throw new SyncClientError("notInitialized");
	checkProof(state, snapshot, state.localEpoch, state.url); await uncertain(sql); return state;
}
async function aliasPlan(sql: SqlExecutor, snapshot: CompleteSnapshot, sourceId: string, targetId: string, hashes?: { local: string; remote: string }) {
	const state = await context(sql, snapshot), source = await meta(sql, sourceId), targetKnown = await meta(sql, targetId);
	const target = snapshot.aggregates.find((root) => root.id === targetId);
	// This is a local import mapping, NOT a server food merge/delete. Source
	// must be completely unknown even to the retained server UUID registry.
	if (sourceId === targetId || !source || source.entity !== "foods" || source.aggregate_uuid !== sourceId || source.deleted_at !== null || source.local_id === null || source.server_revision !== 0 || snapshot.identities.some((row) => row.uuid === sourceId)) throw new SyncClientError("aliasSourceRegistered");
	if (!target || target.entity !== "foods" || !target.data || target.deletedAt !== null) throw new SyncClientError("invalidAliasTarget");
	if (targetKnown && (targetKnown.entity !== "foods" || targetKnown.aggregate_uuid !== targetId || targetKnown.server_revision > target.version)) throw new SyncClientError("invalidAliasTarget");
	if ((await sql.query("SELECT operation_id FROM sync_outbox WHERE entity_uuid=? LIMIT 1;", [targetId])).length) throw new SyncClientError("aliasTargetEdited");
	const sourceData = await aggregatePayload(sql, "foods", sourceId, new Map());
	if (typeof sourceData.ean !== "string" || sourceData.ean !== target.data.ean) throw new SyncClientError("aliasEanMismatch");
	const ingredients = await sql.query<{ uuid: string }>("SELECT r.uuid FROM recipe_ingredients i JOIN recipes r ON r.id=i.recipe_id WHERE i.food_id=?;", [source.local_id]);
	const meals = await sql.query<{ uuid: string }>("SELECT uuid FROM meal_logs WHERE food_id=?;", [source.local_id]);
	const roots = new Set([sourceId, ...ingredients.map((row) => row.uuid), ...meals.map((row) => row.uuid)]);
	const queue = await sql.query<Queued>("SELECT batch_id,entity_uuid,base_revision,payload FROM sync_outbox ORDER BY sequence;");
	// Also capture historical intents that no longer occur in current rows.
	for (const row of queue) if (referenceIds(storedJson(row.payload)).includes(sourceId)) roots.add(row.entity_uuid);
	let changed = true;
	while (changed) {
		changed = false; const batches = new Set(queue.filter((row) => roots.has(row.entity_uuid)).map((row) => row.batch_id));
		for (const row of queue) if (batches.has(row.batch_id) && !roots.has(row.entity_uuid)) { roots.add(row.entity_uuid); changed = true; }
	}
	if (roots.has(targetId)) throw new SyncClientError("aliasTargetEdited");
	const companions: FoodAliasReview["companions"] = [];
	for (const id of [...roots].sort()) {
		if (id === sourceId) continue;
		const known = await meta(sql, id); if (!known || known.uuid !== known.aggregate_uuid) throw new SyncClientError("corruptStaging");
		const payload = known.deleted_at === null ? await aggregatePayload(sql, known.aggregate_entity, id, new Map()) : null;
		companions.push({ id, entity: known.aggregate_entity, name: String(payload?.name ?? payload?.name_de ?? payload?.logged_at ?? id) });
		const bases = new Set(queue.filter((row) => row.entity_uuid === id).map((row) => row.base_revision));
		if (bases.size > 1) throw new SyncClientError("aliasMixedBases");
	}
	const token = await digest({ kind: "foodAlias", sourceId, targetId, local: hashes?.local ?? await localDigest(sql), remote: hashes?.remote ?? await remoteDigest(snapshot) });
	return { source, target, roots, queue, review: { token, localEpoch: state.localEpoch, url: state.url!, sourceId, targetId, source: sourceData, target, ingredientCount: ingredients.length, mealCount: meals.length, companions } satisfies FoodAliasReview };
}
export function createFoodAliases(db: SqlDatabase, saveSafety: (backup: MunchlingBackup) => Promise<void>) {
	return {
		preview: (pages: SnapshotPage[]) => db.transaction(async (sql) => {
			const snapshot = completeSnapshot(pages); await context(sql, snapshot);
			const remoteByEan = new Map(snapshot.aggregates.filter((root) => root.entity === "foods" && root.data?.ean != null).map((root) => [String(root.data!.ean), root.id]));
			const local = await sql.query<{ uuid: string; ean: string }>("SELECT f.uuid,f.ean FROM foods f JOIN sync_records r ON r.uuid=f.uuid WHERE r.server_revision=0 AND f.ean IS NOT NULL ORDER BY f.uuid;");
			const registered = new Set(snapshot.identities.map((row) => row.uuid));
			const hashes = { local: await localDigest(sql), remote: await remoteDigest(snapshot) }; const result: FoodAliasReview[] = [];
			for (const row of local) {
				const target = remoteByEan.get(row.ean); if (!target || registered.has(row.uuid)) continue;
				// A locally edited target needs ordinary version decisions first.
				if ((await sql.query("SELECT operation_id FROM sync_outbox WHERE entity_uuid=? LIMIT 1;", [target])).length) continue;
				result.push((await aliasPlan(sql, snapshot, row.uuid, target, hashes)).review);
			}
			return result;
		}),
		commit: (token: string, sourceId: string, targetId: string, freshPages: SnapshotPage[], confirmed = false) => db.transaction(async (sql) => {
			const snapshot = completeSnapshot(freshPages), plan = await aliasPlan(sql, snapshot, sourceId, targetId);
			if (plan.review.token !== token) throw new SyncClientError("previewChanged");
			if (!confirmed) throw new SyncClientError("confirmFoodAlias");
			await saveSafety(cloneBackup(await snapshotBackup(sql)));
			const batches = new Set(plan.queue.filter((row) => plan.roots.has(row.entity_uuid)).map((row) => row.batch_id));
			for (const batch of batches) await sql.run("DELETE FROM sync_outbox WHERE batch_id=? AND status='pending';", [batch]);
			await sql.run("DELETE FROM sync_conflicts WHERE uuid=?;", [targetId]);
			// Free only this source's EAN, without creating a transient intent.
			await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;");
			await sql.run("UPDATE foods SET ean=NULL WHERE uuid=?;", [sourceId]);
			const targetPlan = await preflight(sql, [plan.target], snapshot.identities, new Set([targetId]));
			if (targetPlan.reason) throw new SyncClientError(targetPlan.reason);
			await writeRoots(sql, targetPlan.changes, snapshot.identities);
			const target = (await meta(sql, targetId))!;
			// Normal local triggers advance affected aggregate revisions. There
			// is no delete cascade: all FKs move before the source is removed.
			await sql.run("UPDATE recipe_ingredients SET food_id=? WHERE food_id=?;", [target.local_id, plan.source.local_id]);
			await sql.run("UPDATE meal_logs SET food_id=? WHERE food_id=?;", [target.local_id, plan.source.local_id]);
			await sql.run("DELETE FROM foods WHERE uuid=?;", [sourceId]);
			const dirty = await sql.query<{ uuid: string }>("SELECT uuid FROM sync_dirty;");
			if (dirty.some((row) => !plan.roots.has(row.uuid))) throw new SyncClientError("localStateChanged");
			await sql.run("DELETE FROM sync_dirty;");
			const batchId = createUuid(), operations: ServerOperation[] = [];
			for (const id of [...plan.roots].sort()) {
				if (id === sourceId) continue; // Unknown source is retired locally, not deleted on the server.
				const known = (await meta(sql, id))!;
				const payload = known.deleted_at === null ? await aggregatePayload(sql, known.aggregate_entity, id, new Map()) : { id, deleted_at: known.deleted_at };
				const basis = plan.queue.find((row) => row.entity_uuid === id)?.base_revision ?? known.server_revision;
				operations.push({ operationId: createUuid(), entity: known.aggregate_entity, entityUuid: id, baseRevision: basis, operation: known.deleted_at === null ? "upsert" : "delete", payload });
			}
			if (operations.length) {
				const batch = normalizeWriteBatch({ batchId, serverInstanceId: snapshot.first.serverInstanceId, serverEpoch: snapshot.first.serverEpoch, operations });
				for (const operation of batch.operations) {
					const known = (await meta(sql, operation.entityUuid))!;
					await sql.run("INSERT INTO sync_outbox(batch_id,operation_id,entity,entity_uuid,operation,local_revision,base_revision,payload) VALUES (?,?,?,?,?,?,?,?);", [batchId, operation.operationId, operation.entity, operation.entityUuid, operation.operation, known.local_revision, operation.baseRevision, JSON.stringify(operation.payload)]);
				}
			}
			const state = await receiveState(sql), id = `alias:${createUuid()}`;
			await sql.run("INSERT INTO sync_inbox(id,local_epoch,server_instance_id,server_epoch,from_cursor,to_cursor,payload,status,reason) VALUES (?,?,?,?,?,?,?,'applied','foodAlias');", [id, state.localEpoch, state.serverInstanceId, state.serverEpoch, state.cursor, state.cursor!, JSON.stringify({ sourceId, targetId, roots: [...plan.roots].sort(), retiredBatches: [...batches], snapshotId: snapshot.first.snapshotId, snapshotCursor: snapshot.first.cursor })]);
			return { id, pendingBatch: operations.length ? batchId : null, affectedRoots: plan.roots.size - 1 };
		}),
	};
}
