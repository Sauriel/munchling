import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { snapshotBackup } from "../database/backup";
import { aggregatePayload } from "../database/outbox";
import { cloneBackup, type MunchlingBackup } from "../../../shared/domain/backup";
import type { ServerOperation, ServerAggregate } from "../../../shared/domain/server";
import type { SnapshotPage } from "../../../shared/domain/protocol";
import { completeSnapshot, type CompleteSnapshot } from "../../../shared/domain/snapshot";
import { createUuid, type SyncAggregate } from "../../../shared/domain/sync";
import { replyAggregate, SyncClientError, validated } from "../../../shared/domain/replies";
import { normalizeWriteBatch } from "../../../shared/domain/server-validation";
import { validateRecipeGraph } from "../../../shared/domain/validation";
import { adoptStagedSnapshot, deletionDependents, meta, preflight, referenceIds, writeRoots } from "./apply";
import { checkLocalContext, receiveState, stagedSnapshot, storedJson, type ReceiveState } from "./staging";

type Pending = { batch_id: string; entity_uuid: string; status: string; entity: SyncAggregate; payload: string };
type Inbox = { id: string; payload: string; local_epoch: string; server_instance_id: string; server_epoch: string };
export type InitialMode = "combine" | "local" | "server";
export type DecisionChoice = "local" | "server";
export type DecisionEntry = { id: string; entity: SyncAggregate; base: unknown; local: Record<string, unknown> | null; remote: ServerAggregate | null; deletedLocally: boolean };
export type InitialReview = { token: string; localEpoch: string; url: string; localCount: number; serverCount: number; snapshotId: string };
export type ConflictReview = { token: string; localEpoch: string; url: string; entries: DecisionEntry[]; groups: number };

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
export async function digest(value: unknown) {
	if (!globalThis.crypto?.subtle) throw new SyncClientError("secureContextRequired");
	const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
	return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
export async function localDigest(sql: SqlExecutor) {
	return digest({ business: (await snapshotBackup(sql)).data, state: await sql.query("SELECT * FROM sync_state;"), records: await sql.query("SELECT * FROM sync_records ORDER BY uuid;"), queue: await sql.query("SELECT * FROM sync_outbox ORDER BY sequence;"), dirty: await sql.query("SELECT * FROM sync_dirty ORDER BY uuid;"), conflicts: await sql.query("SELECT * FROM sync_conflicts ORDER BY uuid;"), inbox: await sql.query("SELECT * FROM sync_inbox ORDER BY id;"), downloads: await sql.query("SELECT * FROM sync_download ORDER BY id;") });
}
export async function remoteDigest(snapshot: CompleteSnapshot) {
	return digest({ instance: snapshot.first.serverInstanceId, epoch: snapshot.first.serverEpoch, cursor: snapshot.first.cursor, roots: [...snapshot.aggregates].sort((a, b) => a.id.localeCompare(b.id)), identities: [...snapshot.identities].sort((a, b) => a.uuid.localeCompare(b.uuid)) });
}
export async function uncertain(sql: SqlExecutor) {
	if ((await sql.query("SELECT operation_id FROM sync_outbox WHERE status='inflight' LIMIT 1;")).length) throw new SyncClientError("unconfirmedUpload");
}
export function checkProof(state: ReceiveState, snapshot: CompleteSnapshot, localEpoch: string, url: string) {
	checkLocalContext(state, localEpoch, url, snapshot.first);
	if (state.cursor !== null && Number(snapshot.first.cursor) < Number(state.cursor)) throw new SyncClientError("staleServerSnapshot");
}
async function initialReview(sql: SqlExecutor) {
	const staged = await stagedSnapshot(sql), state = await receiveState(sql);
	checkProof(state, staged.snapshot, staged.row.local_epoch, staged.row.server_url);
	if (state.cursor !== null) throw new SyncClientError("alreadyInitialized");
	await uncertain(sql);
	const localCount = (await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM sync_records WHERE uuid=aggregate_uuid AND deleted_at IS NULL;"))[0]!.n;
	return { token: await digest({ kind: "initial", local: await localDigest(sql), remote: await remoteDigest(staged.snapshot) }), localEpoch: state.localEpoch, url: staged.row.server_url, localCount, serverCount: staged.snapshot.aggregates.filter((root) => root.data !== null).length, snapshotId: staged.row.id };
}
async function conflictReview(sql: SqlExecutor, snapshot: CompleteSnapshot) {
	const state = await receiveState(sql); if (state.url === null || state.cursor === null) throw new SyncClientError("notInitialized");
	checkProof(state, snapshot, state.localEpoch, state.url); await uncertain(sql);
	const inbox = await sql.query<Inbox>("SELECT * FROM sync_inbox WHERE status='blocked' ORDER BY to_cursor,id;");
	const ids = new Set<string>();
	for (const row of inbox) {
		if (row.local_epoch !== state.localEpoch || row.server_instance_id !== state.serverInstanceId || row.server_epoch !== state.serverEpoch) throw new SyncClientError("corruptStaging");
		const packet = storedJson<{ aggregates?: ServerAggregate[]; changes?: { aggregate: ServerAggregate }[] }>(row.payload);
		const roots = packet.aggregates ?? packet.changes?.map((change) => change.aggregate);
		if (!Array.isArray(roots)) throw new SyncClientError("corruptStaging");
		const seen = new Set<string>(); for (const root of roots) { validated(() => replyAggregate(root, seen)); ids.add(root.id); }
	}
	const remote = new Map(snapshot.aggregates.map((root) => [root.id, root]));
	// Include whole pending local transactions, transitively. Never split an
	// old pending batch when replacing its intent with a manual decision.
	const queue = await sql.query<Pending>("SELECT batch_id,entity_uuid,status,entity,payload FROM sync_outbox ORDER BY sequence;");
	let expanded = true;
	while (expanded) {
		expanded = false; const batches = new Set(queue.filter((row) => ids.has(row.entity_uuid)).map((row) => row.batch_id));
		for (const row of queue) if (batches.has(row.batch_id) && !ids.has(row.entity_uuid)) { ids.add(row.entity_uuid); expanded = true; }
		const eans = new Map<string, string>(); const deleted = new Set<string>();
		for (const id of ids) {
			const root = remote.get(id);
			if (root?.data && root.entity === "foods" && root.data.ean !== null) eans.set(String(root.data.ean), id);
			if (root?.deletedAt) {
				deleted.add(id);
				for (const dependent of await deletionDependents(sql, root)) if (!ids.has(dependent.uuid)) { ids.add(dependent.uuid); expanded = true; }
			}
		}
		const localFoods = await sql.query<{ uuid: string; ean: string }>("SELECT uuid,ean FROM foods WHERE ean IS NOT NULL;");
		for (const row of localFoods) if (eans.has(row.ean) && !ids.has(row.uuid)) { ids.add(row.uuid); expanded = true; }
		// Supersede historical pending dependency/EAN intents as a whole too;
		// editing the current row alone must not leave an older doomed upload.
		for (const row of queue) {
			const payload = storedJson<Record<string, unknown>>(row.payload);
			if (!ids.has(row.entity_uuid) && (referenceIds(payload).some((id) => deleted.has(id)) || row.entity === "foods" && typeof payload.ean === "string" && eans.has(payload.ean))) { ids.add(row.entity_uuid); expanded = true; }
		}
		for (const id of [...ids]) {
			const root = remote.get(id); if (!root?.data) continue;
			for (const reference of referenceIds(root.data)) {
				const known = await meta(sql, reference);
				if (remote.has(reference) && (!known || known.deleted_at !== null || known.local_id === null) && !ids.has(reference)) { ids.add(reference); expanded = true; }
			}
		}
	}
	const entries: DecisionEntry[] = [];
	for (const id of [...ids].sort()) {
		const known = await meta(sql, id), current = remote.get(id) ?? null;
		if (known && (!current && known.server_revision > 0 || current && current.version < known.server_revision)) throw new SyncClientError("staleServerSnapshot");
		if (known && (known.uuid !== known.aggregate_uuid || current && known.entity !== current.entity)) throw new SyncClientError("identityConflict");
		const ownership = snapshot.identities.find((row) => row.uuid === id);
		if (known && ownership && (ownership.aggregateUuid !== id || ownership.entity !== known.entity)) throw new SyncClientError("identityConflict");
		if (!known && !current) throw new SyncClientError("corruptStaging");
		const entity = current?.entity ?? known!.aggregate_entity;
		const local = known ? known.deleted_at === null ? await aggregatePayload(sql, entity, id, new Map()) : { id, deleted_at: known.deleted_at } : null;
		const baseline = (await sql.query<{ payload: string }>("SELECT payload FROM sync_baselines WHERE uuid=?;", [id]))[0];
		entries.push({ id, entity, base: baseline ? storedJson(baseline.payload) : null, local, remote: current, deletedLocally: !!known?.deleted_at });
	}
	return { review: { token: await digest({ kind: "conflict", local: await localDigest(sql), remote: await remoteDigest(snapshot), ids: [...ids].sort() }), localEpoch: state.localEpoch, url: state.url, entries, groups: inbox.length }, inbox, queue };
}
function checkServerProjection(snapshot: CompleteSnapshot, entries: DecisionEntry[], choices: Record<string, DecisionChoice>) {
	const roots = new Map(snapshot.aggregates.map((root) => [root.id, root]));
	for (const entry of entries) if (choices[entry.id] === "local") roots.set(entry.id, { entity: entry.entity, id: entry.id, version: entry.remote?.version ?? 0, deletedAt: entry.deletedLocally ? String(entry.local!.deleted_at) : null, data: entry.deletedLocally ? null : entry.local });
	const eans = new Set<string>(), edges: { recipeId: string; subRecipeId: string | null }[] = [], ids = new Set<string>();
	const checkReference = (id: unknown, entity: string) => { const root = roots.get(String(id)); if (!root || root.entity !== entity || !root.data) throw new SyncClientError("serverDependency"); };
	for (const root of roots.values()) {
		if (!root.data) continue;
		validated(() => replyAggregate({ ...root, version: Math.max(1, root.version) }, ids));
		if (root.entity === "foods" && root.data.ean !== null) { const ean = String(root.data.ean); if (eans.has(ean)) throw new SyncClientError("eanConflict"); eans.add(ean); }
		if (root.entity === "recipes") for (const child of root.data.ingredients as Record<string, unknown>[]) {
			if (child.food_id !== null) checkReference(child.food_id, "foods"); if (child.sub_recipe_id !== null) checkReference(child.sub_recipe_id, "recipes");
			edges.push({ recipeId: root.id, subRecipeId: child.sub_recipe_id as string | null });
		}
		if (root.entity === "meal_logs") {
			if (root.data.food_id !== null) checkReference(root.data.food_id, "foods"); if (root.data.recipe_id !== null) checkReference(root.data.recipe_id, "recipes");
			for (const portion of root.data.profiles as Record<string, unknown>[]) checkReference(portion.profile_id, "profiles");
		}
	}
	// A local child cannot steal a server-owned UUID, even from an inactive root.
	const registry = new Map(snapshot.identities.map((row) => [row.uuid, row]));
	for (const entry of entries) if (choices[entry.id] === "local" && !entry.deletedLocally) {
		for (const [field, entity] of [["ingredients", "recipe_ingredients"], ["profiles", "meal_log_profiles"]] as const) for (const child of entry.local![field] as Record<string, unknown>[] ?? []) {
			const owner = registry.get(String(child.id)); if (owner && (owner.entity !== entity || owner.aggregateUuid !== entry.id)) throw new SyncClientError("identityConflict");
		}
	}
	try { validateRecipeGraph(edges); } catch { throw new SyncClientError("recipeCycle"); }
}

export function createSyncDecisions(db: SqlDatabase, saveSafety: (backup: MunchlingBackup) => Promise<void>) {
	return {
		initialPreview: () => db.transaction(initialReview),
		initialCommit: (token: string, mode: InitialMode, freshPages: SnapshotPage[]) => db.transaction(async (sql) => {
			const review = await initialReview(sql), staged = await stagedSnapshot(sql), fresh = completeSnapshot(freshPages);
			checkProof(await receiveState(sql), fresh, review.localEpoch, review.url);
			if (token !== review.token || await remoteDigest(fresh) !== await remoteDigest(staged.snapshot)) throw new SyncClientError("previewChanged");
			if (!["combine", "local", "server"].includes(mode)) throw new SyncClientError("invalidDecision");
			if (mode === "local" && review.serverCount !== 0) throw new SyncClientError("sharedDataReplacementForbidden");
			await saveSafety(cloneBackup(await snapshotBackup(sql)));
			if (mode !== "server") return adoptStagedSnapshot(sql, review.localEpoch);
			// Explicit local replacement only. Never send a household restore/delete.
			await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;");
			for (const statement of ["DELETE FROM meal_log_profiles;", "DELETE FROM meal_logs;", "DELETE FROM recipe_ingredients;", "DELETE FROM recipes;", "DELETE FROM foods;", "DELETE FROM profiles;", "DELETE FROM sync_outbox;", "DELETE FROM sync_dirty;", "DELETE FROM sync_baselines;", "DELETE FROM sync_conflicts;", "DELETE FROM sync_records;", "DELETE FROM sync_inbox;"]) await sql.run(statement);
			await writeRoots(sql, fresh.aggregates, fresh.identities);
			await sql.run("UPDATE sync_state SET local_epoch=?,server_url=?,server_instance_id=?,server_epoch=?,pull_cursor=?,enabled=0 WHERE id=1;", [createUuid(), review.url, fresh.first.serverInstanceId, fresh.first.serverEpoch, fresh.first.cursor]);
			await sql.run("DELETE FROM sync_download;");
			return { id: `snapshot:${fresh.first.snapshotId}`, status: "applied" as const, reason: null };
		}),
		conflictPreview: (pages: SnapshotPage[]) => db.transaction(async (sql) => (await conflictReview(sql, completeSnapshot(pages))).review),
		resolve: (token: string, choices: Record<string, DecisionChoice>, freshPages: SnapshotPage[], confirmDeletion = false) => db.transaction(async (sql) => {
			const snapshot = completeSnapshot(freshPages), { review, inbox, queue } = await conflictReview(sql, snapshot);
			if (token !== review.token) throw new SyncClientError("previewChanged");
			if (!review.entries.length || Object.keys(choices).length !== review.entries.length || review.entries.some((entry) => !["local", "server"].includes(choices[entry.id]!))) throw new SyncClientError("invalidDecision");
			for (const entry of review.entries) {
				if (choices[entry.id] === "local" && !entry.local || choices[entry.id] === "server" && !entry.remote) throw new SyncClientError("invalidDecision");
				if ((entry.deletedLocally || entry.remote?.deletedAt !== null && entry.remote !== null) && !confirmDeletion) throw new SyncClientError("confirmDeletion");
			}
			checkServerProjection(snapshot, review.entries, choices);
			await saveSafety(cloneBackup(await snapshotBackup(sql)));
			const chosen = new Set(review.entries.map((entry) => entry.id));
			const replacedBatches = new Set(queue.filter((row) => chosen.has(row.entity_uuid)).map((row) => row.batch_id));
			for (const batch of replacedBatches) await sql.run("DELETE FROM sync_outbox WHERE batch_id=? AND status='pending';", [batch]);
			for (const id of chosen) await sql.run("DELETE FROM sync_conflicts WHERE uuid=?;", [id]);
			const serverRoots = review.entries.filter((entry) => choices[entry.id] === "server").map((entry) => entry.remote!);
			const plan = await preflight(sql, serverRoots, snapshot.identities, new Set(serverRoots.map((root) => root.id)));
			if (plan.reason) throw new SyncClientError(plan.reason);
			await writeRoots(sql, plan.changes, snapshot.identities);
			const batch = createUuid(), operations: ServerOperation[] = [];
			for (const entry of review.entries) if (choices[entry.id] === "local") {
				const known = (await meta(sql, entry.id))!, revision = entry.remote?.version ?? 0;
				await sql.run("UPDATE sync_records SET server_revision=? WHERE uuid=?;", [revision, entry.id]);
				await sql.run("INSERT OR REPLACE INTO sync_baselines(uuid,server_revision,payload) VALUES (?,?,?);", [entry.id, revision, JSON.stringify(entry.remote?.data ?? (entry.remote ? { id: entry.id, deleted_at: entry.remote.deletedAt } : null))]);
				if (entry.deletedLocally && !entry.remote) continue;
				const operation: ServerOperation = { operationId: createUuid(), entity: entry.entity, entityUuid: entry.id, operation: entry.deletedLocally ? "delete" : "upsert", baseRevision: revision, payload: entry.local! };
				operations.push(operation);
				await sql.run("INSERT INTO sync_outbox(batch_id,operation_id,entity,entity_uuid,operation,local_revision,base_revision,payload) VALUES (?,?,?,?,?,?,?,?);", [batch, operation.operationId, entry.entity, entry.id, operation.operation, known.local_revision, revision, JSON.stringify(operation.payload)]);
			}
			if (operations.length) normalizeWriteBatch({ batchId: batch, serverInstanceId: snapshot.first.serverInstanceId, serverEpoch: snapshot.first.serverEpoch, operations });
			for (const group of inbox) await sql.run("UPDATE sync_inbox SET status='applied',reason='manualDecision' WHERE id=?;", [group.id]);
			const state = await receiveState(sql), id = `decision:${createUuid()}`;
			await sql.run("INSERT INTO sync_inbox(id,local_epoch,server_instance_id,server_epoch,from_cursor,to_cursor,payload,status,reason) VALUES (?,?,?,?,?,?,?,'applied','manualDecision');", [id, state.localEpoch, state.serverInstanceId, state.serverEpoch, state.cursor, state.cursor!, JSON.stringify({ choices, groups: inbox.map((row) => row.id), snapshotId: snapshot.first.snapshotId, snapshotCursor: snapshot.first.cursor })]);
			return { id, pendingBatch: batch, resolvedGroups: inbox.length };
		}),
	};
}
