import { createUuid, type OutboxOperation, type SyncAggregate, type SyncEntity } from "../../../shared/domain/sync";
import type { SqlDatabase, SqlExecutor } from "./executor";

type Row = Record<string, unknown> & { id: number; uuid: string };
async function findRow(sql: SqlExecutor, entity: SyncEntity, uuid: string): Promise<Row | null> {
	const statements: Record<SyncEntity, string> = {
		profiles: "SELECT * FROM profiles WHERE uuid=?;", foods: "SELECT * FROM foods WHERE uuid=?;",
		recipes: "SELECT * FROM recipes WHERE uuid=?;", recipe_ingredients: "SELECT * FROM recipe_ingredients WHERE uuid=?;",
		meal_logs: "SELECT * FROM meal_logs WHERE uuid=?;", meal_log_profiles: "SELECT * FROM meal_log_profiles WHERE uuid=?;",
	};
	return (await sql.query<Row>(statements[entity], [uuid]))[0] ?? null;
}
async function wireRow(sql: SqlExecutor, row: Row, identities: Map<string, string>): Promise<Record<string, unknown>> {
	const { id: _localId, uuid, ...payload } = row;
	const references: Record<string, SyncEntity> = { food_id: "foods", recipe_id: "recipes", sub_recipe_id: "recipes", meal_log_id: "meal_logs", profile_id: "profiles" };
	for (const [field, entity] of Object.entries(references)) {
		if (payload[field] == null) continue;
		const key = `${entity}:${payload[field]}`;
		let reference = identities.get(key);
		if (!reference) {
			const record = (await sql.query<{ uuid: string }>("SELECT uuid FROM sync_records WHERE entity=? AND local_id=? AND deleted_at IS NULL;", [entity, Number(payload[field])]))[0];
			if (!record) throw new Error(`Missing sync identity for ${field}.`);
			reference = record.uuid;
			identities.set(key, reference);
		}
		payload[field] = reference;
	}
	return { id: uuid, ...payload };
}
async function aggregatePayload(sql: SqlExecutor, entity: SyncAggregate, uuid: string, identities: Map<string, string>): Promise<Record<string, unknown>> {
	const row = await findRow(sql, entity, uuid);
	if (!row) throw new Error("Missing active sync aggregate.");
	identities.set(`${entity}:${row.id}`, uuid);
	const payload = await wireRow(sql, row, identities);
	if (entity === "recipes") {
		const children = await sql.query<Row>("SELECT * FROM recipe_ingredients WHERE recipe_id=? ORDER BY id;", [row.id]);
		payload.ingredients = await Promise.all(children.map((child) => wireRow(sql, child, identities)));
	} else if (entity === "meal_logs") {
		const children = await sql.query<Row>("SELECT * FROM meal_log_profiles WHERE meal_log_id=? ORDER BY id;", [row.id]);
		payload.profiles = await Promise.all(children.map((child) => wireRow(sql, child, identities)));
	}
	return payload;
}

// Called inside the SAME transaction as the fach writes, after the complete
// aggregate is valid, before commit. Triggers also catch FK cascades and SQL seed.
export async function flushOutbox(sql: SqlExecutor) {
	if (!(await sql.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_dirty';")).length) return;
	const dirty = await sql.query<{ entity: SyncAggregate; uuid: string; local_revision: number; server_revision: number; deleted_at: string | null }>(
		"SELECT d.entity,d.uuid,r.local_revision,r.server_revision,r.deleted_at FROM sync_dirty d JOIN sync_records r ON r.uuid=d.uuid ORDER BY d.rowid;",
	);
	if (!dirty.length) return;
	const batch = createUuid();
	const identities = new Map<string, string>();
	for (const record of dirty) {
		const payload = record.deleted_at === null
			? await aggregatePayload(sql, record.entity, record.uuid, identities)
			: { id: record.uuid, deleted_at: record.deleted_at };
		await sql.run(
			`INSERT INTO sync_outbox (batch_id,operation_id,entity,entity_uuid,operation,local_revision,base_revision,payload)
			 VALUES (?,?,?,?,?,?,?,?);`,
			[batch, createUuid(), record.entity, record.uuid, record.deleted_at === null ? "upsert" : "delete", record.local_revision, record.server_revision, JSON.stringify(payload)],
		);
	}
	await sql.run("DELETE FROM sync_dirty;");
}

type OutboxRow = {
	sequence: number; batch_id: string; operation_id: string; entity: SyncAggregate; entity_uuid: string;
	operation: "upsert" | "delete"; local_revision: number; base_revision: number; payload: string; status: "pending" | "inflight";
};
function mapOperation(row: OutboxRow): OutboxOperation {
	let payload: Record<string, unknown>;
	try { payload = JSON.parse(row.payload); } catch (cause) { throw new Error("Corrupt local sync operation.", { cause }); }
	return { sequence: row.sequence, batchId: row.batch_id, operationId: row.operation_id, entity: row.entity, entityUuid: row.entity_uuid, operation: row.operation, localRevision: row.local_revision, baseRevision: row.base_revision, payload, status: row.status };
}

export function createSyncQueue(database: SqlDatabase) {
	return {
		list: async () => (await database.query<OutboxRow>("SELECT * FROM sync_outbox ORDER BY sequence;")).map(mapOperation),
		claimNextBatch: () => database.transaction(async (sql) => {
			// A lost response resumes exactly the same persisted IDs/payloads.
			const first = (await sql.query<{ batch_id: string; status: string }>("SELECT batch_id,status FROM sync_outbox ORDER BY sequence LIMIT 1;"))[0];
			if (!first) return [];
			if (first.status === "pending") {
				// Never adopt a newly observed remote version here: that would
				// silently rebase a pending edit instead of detecting its conflict.
				await sql.run("UPDATE sync_outbox SET status='inflight' WHERE batch_id=?;", [first.batch_id]);
			}
			return (await sql.query<OutboxRow>("SELECT * FROM sync_outbox WHERE batch_id=? ORDER BY sequence;", [first.batch_id])).map(mapOperation);
		}),
		acknowledgeBatch: (batchId: string, receipts: { operationId: string; serverRevision: number }[]) => database.transaction(async (sql) => {
			const rows = await sql.query<OutboxRow>("SELECT * FROM sync_outbox WHERE batch_id=? ORDER BY sequence;", [batchId]);
			if (!rows.length) return false; // repeated receipt, already committed locally
			const revisions = new Map(receipts.map((receipt) => [receipt.operationId, receipt.serverRevision]));
			if (receipts.length !== rows.length || revisions.size !== rows.length || rows.some((row) => row.status !== "inflight" || !Number.isSafeInteger(revisions.get(row.operation_id)) || revisions.get(row.operation_id)! <= row.base_revision)) throw new Error("Incomplete or invalid sync batch receipt.");
			for (const row of rows) {
				const revision = revisions.get(row.operation_id)!;
				const known = (await sql.query<{ server_revision: number }>("SELECT server_revision FROM sync_records WHERE uuid=?;", [row.entity_uuid]))[0];
				if (!known || known.server_revision > revision) throw new Error("Missing identity or outdated server revision in sync receipt.");
				await sql.run("UPDATE sync_records SET server_revision=? WHERE uuid=?;", [revision, row.entity_uuid]);
				// Only an accepted LOCAL predecessor may advance queued local
				// bases. A pull must leave pending bases untouched for conflicts.
				await sql.run("UPDATE sync_outbox SET base_revision=? WHERE entity_uuid=? AND status='pending';", [revision, row.entity_uuid]);
				await sql.run("INSERT OR REPLACE INTO sync_baselines (uuid,server_revision,payload) VALUES (?,?,?);", [row.entity_uuid, revision, row.payload]);
			}
			await sql.run("DELETE FROM sync_outbox WHERE batch_id=?;", [batchId]);
			return true;
		}),
	};
}

// Transport/conflict handling is intentionally not here. A future pull processor
// must check pending local changes before using this low-level scoped apply mode.
export function applyRemoteTransaction<T>(database: SqlDatabase, work: (sql: SqlExecutor) => Promise<T>) {
	return database.transaction(async (sql) => {
		await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;");
		const result = await work(sql);
		await sql.run("UPDATE sync_state SET tracking_enabled=1 WHERE id=1;");
		return result;
	});
}
