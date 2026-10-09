import type { SqlDatabase, SqlExecutor, SqlValue } from "../database/executor";
import { aggregatePayload } from "../database/outbox";
import type { ServerAggregate } from "../../../shared/domain/server";
import type { ChangePage, ServerBinding, SnapshotIdentity } from "../../../shared/domain/protocol";
import { replyChanges, SyncClientError } from "../../../shared/domain/replies";
import { validateRecipeGraph } from "../../../shared/domain/validation";
import { wireColumns } from "../../../shared/domain/wire-columns";
import type { SyncAggregate, SyncEntity } from "../../../shared/domain/sync";
import { checkLocalContext, receiveState, stagedSnapshot, storedJson } from "./staging";
import { receiveSql, removeChildren } from "./receive-sql";

export type ReceiveContext = ServerBinding & { localEpoch: string; url: string; cursor: string };
export type RecordRow = { uuid: string; entity: SyncEntity; local_id: number | null; aggregate_entity: SyncAggregate; aggregate_uuid: string; local_revision: number; server_revision: number; deleted_at: string | null };
type Outcome = { id: string; status: "applied" | "blocked"; reason: string | null };
const refs: Record<string, SyncAggregate> = { food_id: "foods", recipe_id: "recipes", sub_recipe_id: "recipes", meal_log_id: "meal_logs", profile_id: "profiles" };
export const meta = async (sql: SqlExecutor, uuid: string) => (await sql.query<RecordRow>("SELECT * FROM sync_records WHERE uuid=?;", [uuid]))[0] ?? null;
const rootChildren = (root: ServerAggregate): { entity: "recipe_ingredients" | "meal_log_profiles"; rows: Record<string, unknown>[] } | null => root.data && root.entity === "recipes" ? { entity: "recipe_ingredients", rows: root.data.ingredients as Record<string, unknown>[] } : root.data && root.entity === "meal_logs" ? { entity: "meal_log_profiles", rows: root.data.profiles as Record<string, unknown>[] } : null;
async function pending(sql: SqlExecutor, uuid: string) {
	return (await sql.query("SELECT entity_uuid FROM sync_outbox WHERE entity_uuid=? UNION SELECT uuid FROM sync_conflicts WHERE uuid=?;", [uuid, uuid])).length > 0;
}
export async function deletionDependents(sql: SqlExecutor, root: ServerAggregate) {
	if (root.entity === "foods") return sql.query<{ uuid: string }>("SELECT r.uuid FROM recipes r JOIN recipe_ingredients i ON r.id=i.recipe_id WHERE i.food_id=(SELECT local_id FROM sync_records WHERE uuid=?) UNION SELECT uuid FROM meal_logs WHERE food_id=(SELECT local_id FROM sync_records WHERE uuid=?);", [root.id, root.id]);
	if (root.entity === "recipes") return sql.query<{ uuid: string }>("SELECT r.uuid FROM recipes r JOIN recipe_ingredients i ON r.id=i.recipe_id WHERE i.sub_recipe_id=(SELECT local_id FROM sync_records WHERE uuid=?) UNION SELECT uuid FROM meal_logs WHERE recipe_id=(SELECT local_id FROM sync_records WHERE uuid=?);", [root.id, root.id]);
	if (root.entity === "profiles") return sql.query<{ uuid: string }>("SELECT m.uuid FROM meal_logs m JOIN meal_log_profiles p ON p.meal_log_id=m.id WHERE p.profile_id=(SELECT local_id FROM sync_records WHERE uuid=?);", [root.id]);
	return [];
}
export function referenceIds(payload: Record<string, unknown>): string[] {
	const result: string[] = [];
	for (const field of Object.keys(refs)) if (typeof payload[field] === "string") result.push(payload[field]);
	for (const child of [...(Array.isArray(payload.ingredients) ? payload.ingredients : []), ...(Array.isArray(payload.profiles) ? payload.profiles : [])]) result.push(...referenceIds(child));
	return result;
}
export async function preflight(sql: SqlExecutor, roots: ServerAggregate[], identities: SnapshotIdentity[], force = new Set<string>()) {
	const changes: ServerAggregate[] = [];
	for (const root of roots) {
		const known = await meta(sql, root.id);
		if (known && (known.entity !== root.entity || known.aggregate_uuid !== root.id)) return { reason: "identityConflict", changes: [] };
		if (known && root.version <= known.server_revision && !force.has(root.id)) continue; // Own receipts/newer accepted local predecessors win over older feed entries.
		if (await pending(sql, root.id)) return { reason: "localChanges", changes: [] };
		changes.push(root);
	}
	for (const identity of identities) {
		const known = await meta(sql, identity.uuid);
		if (known && (known.entity !== identity.entity || known.aggregate_uuid !== identity.aggregateUuid)) return { reason: "identityConflict", changes: [] };
	}
	const proposed = new Map(changes.map((root) => [root.id, root]));
	for (const root of changes) {
		const children = rootChildren(root);
		for (const child of children?.rows ?? []) { const known = await meta(sql, String(child.id)); if (known && (known.entity !== children!.entity || known.aggregate_uuid !== root.id)) return { reason: "identityConflict", changes: [] }; }
		if (root.deletedAt !== null) {
			for (const dependent of await deletionDependents(sql, root)) if (!proposed.has(dependent.uuid) || await pending(sql, dependent.uuid)) return { reason: "localDependency", changes: [] };
			const queued = await sql.query<{ payload: string }>("SELECT payload FROM sync_outbox;");
			if (queued.some((row) => referenceIds(storedJson(row.payload)).includes(root.id))) return { reason: "localDependency", changes: [] };
		} else {
			for (const row of [root.data!, ...children?.rows ?? []]) for (const [field, entity] of Object.entries(refs)) {
				if (row[field] == null) continue;
				const id = String(row[field]), next = proposed.get(id), known = await meta(sql, id);
				if (next ? next.entity !== entity || next.deletedAt !== null : !known || known.entity !== entity || known.deleted_at !== null || known.local_id === null) return { reason: "missingReference", changes: [] };
			}
		}
	}
	const foods = await sql.query<{ uuid: string; ean: string | null }>("SELECT uuid,ean FROM foods WHERE ean IS NOT NULL;"); const eans = new Set<string>();
	for (const food of foods) if (!proposed.has(food.uuid)) eans.add(food.ean!);
	for (const root of changes) if (root.entity === "foods" && root.data?.ean != null) { const ean = String(root.data.ean); if (eans.has(ean)) return { reason: "eanConflict", changes: [] }; eans.add(ean); }
	const oldEdges = await sql.query<{ recipeId: string; subRecipeId: string | null }>("SELECT r.uuid AS recipeId,s.uuid AS subRecipeId FROM recipe_ingredients i JOIN recipes r ON r.id=i.recipe_id LEFT JOIN recipes s ON s.id=i.sub_recipe_id;");
	const edges = oldEdges.filter((edge) => !proposed.has(edge.recipeId));
	for (const root of changes) if (root.entity === "recipes" && root.data) for (const child of root.data.ingredients as Record<string, unknown>[]) edges.push({ recipeId: root.id, subRecipeId: child.sub_recipe_id as string | null });
	try { validateRecipeGraph(edges); } catch { return { reason: "recipeCycle", changes: [] }; }
	return { reason: null, changes };
}
async function writeRow(sql: SqlExecutor, entity: SyncEntity, ownerEntity: SyncAggregate, owner: string, data: Record<string, unknown>) {
	const uuid = String(data.id), known = await meta(sql, uuid);
	if (known && (known.entity !== entity || known.aggregate_uuid !== owner)) throw new SyncClientError("identityConflict");
	const values: SqlValue[] = [];
	for (const field of wireColumns[entity]) {
		const value = data[field];
		if (value != null && refs[field]) { const record = await meta(sql, String(value)); if (!record || record.entity !== refs[field] || record.deleted_at !== null || record.local_id === null) throw new SyncClientError("missingReference"); values.push(record.local_id); }
		else values.push((value ?? null) as SqlValue);
	}
	// Identifiers come only from validated entity enums and immutable wire lists.
	const statements = receiveSql[entity];
	const exists = (await sql.query(statements.find, [uuid])).length > 0;
	if (exists) await sql.run(statements.update, [...values, uuid]);
	else {
		// Insert triggers always create registry rows. Preserve the old numeric
		// ID/revision when resurrecting, and remove only its same-owner registry
		// immediately before the insert, within this suppressed transaction.
		if (known) await sql.run("DELETE FROM sync_records WHERE uuid=?;", [uuid]);
		await sql.run(statements.insert, [known?.local_id ?? null, uuid, ...values]);
		if (known) await sql.run("UPDATE sync_records SET local_revision=?,server_revision=?,aggregate_entity=?,aggregate_uuid=? WHERE uuid=?;", [known.local_revision, known.server_revision, ownerEntity, owner, uuid]);
	}
}
export async function writeRoots(sql: SqlExecutor, roots: ServerAggregate[], identities: SnapshotIdentity[]) {
	await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;");
	// Free unique keys before any replacement, independent of input order.
	for (const root of roots) if (root.entity === "foods") await sql.run("UPDATE foods SET ean=NULL WHERE uuid=?;", [root.id]);
	for (const entity of ["profiles", "foods", "recipes", "meal_logs"] as const) for (const root of roots) if (root.entity === entity && root.data) await writeRow(sql, entity, entity, root.id, root.data);
	for (const root of roots) {
		const children = rootChildren(root); if (!children) continue;
		const parent = (await meta(sql, root.id))!;
		await sql.run(removeChildren[children.entity], [parent.local_id]);
		for (const child of children.rows) await writeRow(sql, children.entity, root.entity, root.id, child);
	}
	for (const entity of ["meal_logs", "recipes", "foods", "profiles"] as const) for (const root of roots) if (root.entity === entity && root.deletedAt !== null) await sql.run(receiveSql[entity].remove, [root.id]);
	for (const root of roots) {
		const known = await meta(sql, root.id);
		if (!known) await sql.run("INSERT INTO sync_records(uuid,entity,aggregate_entity,aggregate_uuid,server_revision,deleted_at) VALUES (?,?,?,?,?,?);", [root.id, root.entity, root.entity, root.id, root.version, root.deletedAt]);
		else await sql.run("UPDATE sync_records SET server_revision=?,deleted_at=? WHERE uuid=?;", [root.version, root.deletedAt, root.id]);
		await sql.run("INSERT OR REPLACE INTO sync_baselines(uuid,server_revision,payload) VALUES (?,?,?);", [root.id, root.version, JSON.stringify(root.data ?? { id: root.id, deleted_at: root.deletedAt })]);
	}
	const updatedOwners = new Set(roots.map((root) => root.id));
	const owners = new Map(identities.filter((row) => row.uuid === row.aggregateUuid).map((row) => [row.uuid, row]));
	for (const identity of identities) {
		if (!updatedOwners.has(identity.aggregateUuid)) continue;
		const known = await meta(sql, identity.uuid); const owner = owners.get(identity.aggregateUuid)!;
		if (!known) await sql.run("INSERT INTO sync_records(uuid,entity,aggregate_entity,aggregate_uuid,server_revision,deleted_at) VALUES (?,?,?,?,?,?);", [identity.uuid, identity.entity, owner.entity, identity.aggregateUuid, identity.version, identity.deletedAt]);
		else if (identity.version >= known.server_revision) await sql.run("UPDATE sync_records SET server_revision=?,deleted_at=? WHERE uuid=?;", [identity.version, identity.deletedAt, identity.uuid]);
	}
	await sql.run("UPDATE sync_state SET tracking_enabled=1 WHERE id=1;");
}
async function retainConflict(sql: SqlExecutor, root: ServerAggregate) {
	const baseline = (await sql.query<{ payload: string }>("SELECT payload FROM sync_baselines WHERE uuid=?;", [root.id]))[0]; const known = await meta(sql, root.id);
	const local = known?.entity === root.entity && known.aggregate_uuid === root.id ? known.deleted_at === null ? await aggregatePayload(sql, root.entity, root.id, new Map()) : { id: root.id, deleted_at: known.deleted_at } : { id: root.id, identity: known };
	await sql.run(`INSERT INTO sync_conflicts(uuid,base_payload,local_payload,remote_payload,server_revision) VALUES (?,?,?,?,?)
 ON CONFLICT(uuid) DO UPDATE SET local_payload=excluded.local_payload,remote_payload=excluded.remote_payload,server_revision=excluded.server_revision WHERE excluded.server_revision>=sync_conflicts.server_revision;`, [root.id, baseline?.payload ?? null, JSON.stringify(local), JSON.stringify(root), root.version]);
}
async function applyGroup(sql: SqlExecutor, context: ReceiveContext, id: string, cursor: string, payload: string, roots: ServerAggregate[], identities: SnapshotIdentity[] = []): Promise<Outcome> {
	const seen = (await sql.query<{ payload: string; status: "applied" | "blocked"; reason: string | null; local_epoch: string; server_instance_id: string; server_epoch: string }>("SELECT * FROM sync_inbox WHERE id=?;", [id]))[0];
	if (seen) {
		if (seen.payload !== payload || seen.local_epoch !== context.localEpoch || seen.server_instance_id !== context.serverInstanceId || seen.server_epoch !== context.serverEpoch) throw new SyncClientError("changedBatch");
		return { id, status: seen.status, reason: seen.reason };
	}
	const plan = await preflight(sql, roots, identities); const status = plan.reason ? "blocked" : "applied";
	if (plan.reason) for (const root of roots) {
		const known = await meta(sql, root.id);
		if (!known || known.server_revision < root.version) await retainConflict(sql, root);
	}
	else await writeRoots(sql, plan.changes, identities);
	await sql.run("INSERT INTO sync_inbox(id,local_epoch,server_instance_id,server_epoch,from_cursor,to_cursor,payload,status,reason) VALUES (?,?,?,?,?,?,?,?,?);", [id, context.localEpoch, context.serverInstanceId, context.serverEpoch, context.cursor, cursor, payload, status, plan.reason]);
	await sql.run("UPDATE sync_state SET pull_cursor=? WHERE id=1;", [cursor]);
	return { id, status, reason: plan.reason };
}
export async function adoptStagedSnapshot(sql: SqlExecutor, expectedLocalEpoch: string) {
	const staged = await stagedSnapshot(sql), state = await receiveState(sql), { first, aggregates, identities } = staged.snapshot;
	checkLocalContext(state, expectedLocalEpoch, staged.row.server_url, first);
	if (state.cursor !== null) throw new SyncClientError("alreadyInitialized");
	const context = { ...first, localEpoch: expectedLocalEpoch, url: staged.row.server_url, cursor: "0" };
	const result = await applyGroup(sql, context, `snapshot:${first.snapshotId}`, first.cursor, JSON.stringify({ aggregates, identities }), aggregates, identities);
	await sql.run("UPDATE sync_state SET server_url=?,server_instance_id=?,server_epoch=?,enabled=0 WHERE id=1;", [context.url, context.serverInstanceId, context.serverEpoch]);
	await sql.run("DELETE FROM sync_download WHERE id=?;", [first.snapshotId]); return result;
}
export function createRemoteReceiver(db: SqlDatabase) {
	return {
		previewSnapshot: () => db.transaction(async (sql) => { const staged = await stagedSnapshot(sql); const plan = await preflight(sql, staged.snapshot.aggregates, staged.snapshot.identities); return { roots: staged.snapshot.aggregates.length, reason: plan.reason, localEpoch: staged.row.local_epoch }; }),
		adoptSnapshot: (expectedLocalEpoch: string) => db.transaction((sql) => adoptStagedSnapshot(sql, expectedLocalEpoch)),
		applyPage: (context: ReceiveContext, input: ChangePage) => db.transaction(async (sql) => {
			const state = await receiveState(sql); checkLocalContext(state, context.localEpoch, context.url, context);
			if (state.cursor === null || state.serverEpoch === "") throw new SyncClientError("notInitialized");
			const page = replyChanges(input, context, context.cursor);
			if (state.cursor !== context.cursor) {
				if (Number(page.cursor) > Number(state.cursor)) throw new SyncClientError("cursorMoved");
				for (const batch of page.batches) { const seen = (await sql.query<{ payload: string }>("SELECT payload FROM sync_inbox WHERE id=?;", [`batch:${batch.batchId}`]))[0]; if (!seen || seen.payload !== JSON.stringify(batch)) throw new SyncClientError("cursorMoved"); }
				return [] as Outcome[];
			}
			const results: Outcome[] = []; let cursor = context.cursor;
			for (const batch of page.batches) { results.push(await applyGroup(sql, { ...context, cursor }, `batch:${batch.batchId}`, batch.lastCursor, JSON.stringify(batch), batch.changes.map((change) => change.aggregate))); cursor = batch.lastCursor; }
			return results;
		}),
		conflicts: () => db.transaction((sql) => sql.query<{ uuid: string; base_payload: string | null; local_payload: string; remote_payload: string; server_revision: number }>("SELECT * FROM sync_conflicts ORDER BY uuid;")),
	};
}
