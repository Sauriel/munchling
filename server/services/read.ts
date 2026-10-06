import { createUuid, isUuid, syncEntities } from "../../shared/domain/sync";
import { ServerWriteError, type ServerAggregate } from "../../shared/domain/server";
import { ServerProtocolError, syncLimits, syncProtocolVersion, type ChangeBatch, type ChangePage, type ServerBinding, type ServerInfo, type SnapshotFragment, type SnapshotIdentity, type SnapshotPage } from "../../shared/domain/protocol";
import type { ServerDatabase, ServerSql } from "../database/connection";
import { serverMigrations } from "../database/schema";
import { readServerState } from "../database/state";
import { aggregateSnapshot, deletionDependents, type Identity } from "./storage";
import { aggregates, utcTimestamp } from "./validation";
import type { SyncAggregate } from "../../shared/domain/sync";

export function readBinding(value: unknown): ServerBinding {
	if (!value || typeof value !== "object") throw new ServerProtocolError("invalidRequest");
	const v = value as Record<string, unknown>;
	if (!isUuid(v.serverInstanceId) || !isUuid(v.serverEpoch)) throw new ServerProtocolError("invalidRequest");
	return { serverInstanceId: v.serverInstanceId, serverEpoch: v.serverEpoch };
}
function checkBinding(state: { instance_uuid: string; epoch_uuid: string }, binding: ServerBinding) {
	if (state.instance_uuid !== binding.serverInstanceId || state.epoch_uuid !== binding.serverEpoch) throw new ServerWriteError("serverChanged");
}
function cursorNumber(value: unknown): number {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ServerProtocolError("cursorInvalid");
	return Number(value);
}
function pageBytes(value: unknown) {
	if (value === undefined) return syncLimits.defaultPageBytes;
	if (typeof value !== "number" || !Number.isInteger(value) || value < syncLimits.minPageBytes || value > syncLimits.maxPageBytes) throw new ServerProtocolError("invalidRequest");
	return value;
}
async function readTransaction<T>(db: ServerDatabase, action: (sql: ServerSql) => Promise<T>) {
	try { return await db.transaction(action); } catch (error) {
		if (error instanceof ServerProtocolError || error instanceof ServerWriteError) throw error;
		throw new ServerProtocolError("DB_READ_FAILED");
	}
}
export function serverInfo(db: ServerDatabase): Promise<ServerInfo> {
	return readTransaction(db, async (sql) => {
		const state = await readServerState(sql);
		return { serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid, protocolVersion: syncProtocolVersion,
			schemaVersion: serverMigrations.at(-1)!.version, cursor: String(state.last_cursor),
			counts: await sql.query<{ entity: string; active: number; deleted: number }>("SELECT entity,COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) AS active,COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) AS deleted FROM sync_identities GROUP BY entity"),
			capabilities: { authentication: "none", fullAggregates: true, manualConflicts: true, atomicBatches: true }, limits: syncLimits };
	});
}
function storedJson<T>(text: string): T {
	try { return JSON.parse(text) as T; } catch { throw new ServerProtocolError("DB_READ_FAILED"); }
}
function validAggregate(value: ServerAggregate): boolean {
	if (!value || !isUuid(value.id) || !aggregates.includes(value.entity) || !Number.isSafeInteger(value.version) || value.version < 1) return false;
	if (value.deletedAt !== null) return typeof value.deletedAt === "string" && utcTimestamp(value.deletedAt, "deletedAt") === value.deletedAt && value.data === null;
	if (!value.data || Array.isArray(value.data) || value.data.id !== value.id) return false;
	return value.entity === "recipes" ? Array.isArray(value.data.ingredients) : value.entity === "meal_logs" ? Array.isArray(value.data.profiles) : true;
}
type Manifest = { uuid: string; instance_uuid: string; epoch_uuid: string; change_cursor: number; page_count: number; expires_at: string };
async function snapshotPage(sql: ServerSql, binding: ServerBinding, id: string, page: number): Promise<SnapshotPage> {
	const meta = (await sql.query<Manifest>("SELECT * FROM sync_snapshots WHERE uuid=? AND expires_at>UTC_TIMESTAMP(3)", [id]))[0];
	if (!meta) throw new ServerProtocolError("snapshotExpired");
	checkBinding(meta, binding);
	if (page >= meta.page_count) throw new ServerProtocolError("invalidRequest");
	const row = (await sql.query<{ payload: string }>("SELECT payload FROM sync_snapshot_pages WHERE snapshot_uuid=? AND page_index=?", [id, page]))[0];
	if (!row) throw new ServerProtocolError("DB_READ_FAILED");
	const fragment = storedJson<SnapshotFragment>(row.payload);
	if (!fragment || !Array.isArray(fragment.aggregates) || !Array.isArray(fragment.identities) || Object.keys(fragment).some((key) => key !== "aggregates" && key !== "identities") || fragment.aggregates.some((value) => !validAggregate(value)) || fragment.identities.some((value) => !value || !isUuid(value.uuid) || !isUuid(value.aggregateUuid) || !syncEntities.includes(value.entity) || !Number.isSafeInteger(value.version) || value.version < 1 || value.deletedAt !== null && utcTimestamp(value.deletedAt, "deletedAt") !== value.deletedAt)) throw new ServerProtocolError("DB_READ_FAILED");
	return { ...binding, protocolVersion: syncProtocolVersion, snapshotId: id, cursor: String(meta.change_cursor),
		expiresAt: utcTimestamp(meta.expires_at, "expires_at"), page, pageCount: meta.page_count, nextPage: page + 1 < meta.page_count ? page + 1 : null, ...fragment };
}
export async function getSnapshotPage(db: ServerDatabase, input: unknown, id: string, page: number) {
	const binding = readBinding(input);
	if (!isUuid(id) || !Number.isSafeInteger(page) || page < 0) throw new ServerProtocolError("invalidRequest");
	return readTransaction(db, async (sql) => { checkBinding(await readServerState(sql), binding); return snapshotPage(sql, binding, id, page); });
}
export async function releaseServerSnapshot(db: ServerDatabase, input: unknown, id: string) {
	const binding = readBinding(input); if (!isUuid(id)) throw new ServerProtocolError("invalidRequest");
	return readTransaction(db, async (sql) => {
		checkBinding(await readServerState(sql), binding);
		const meta = (await sql.query<Manifest>("SELECT * FROM sync_snapshots WHERE uuid=?", [id]))[0];
		if (meta) { checkBinding(meta, binding); await sql.write("DELETE FROM sync_snapshots WHERE uuid=?", [id]); }
		return { released: true };
	});
}
export async function createServerSnapshot(db: ServerDatabase, input: unknown, targetBytes?: number) {
	const binding = readBinding(input), target = pageBytes(targetBytes);
	return readTransaction(db, async (sql) => {
		// The first consistent read establishes the RR view AND its cut cursor.
		// A separate mutex serializes snapshot quotas, never blocks fach writes.
		const state = await readServerState(sql); checkBinding(state, binding);
		if ((await sql.query("SELECT id FROM sync_snapshot_lock WHERE id=1 FOR UPDATE")).length !== 1) throw new ServerProtocolError("DB_READ_FAILED");
		await sql.write("DELETE FROM sync_snapshots WHERE expires_at<=UTC_TIMESTAMP(3)");
		const live = await sql.query("SELECT uuid FROM sync_snapshots WHERE expires_at>UTC_TIMESTAMP(3) FOR UPDATE");
		if (live.length >= syncLimits.maxSnapshots) throw new ServerProtocolError("snapshotBusy");
		const id = createUuid();
		await sql.write("INSERT INTO sync_snapshots(uuid,instance_uuid,epoch_uuid,change_cursor,expires_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))", [id, state.instance_uuid, state.epoch_uuid, state.last_cursor]);
		let fragment: SnapshotFragment = { aggregates: [], identities: [] }, size = 40, total = 0, records = 0, pages = 0;
		const flush = async () => {
			const text = JSON.stringify(fragment); total += Buffer.byteLength(text);
			if (total > syncLimits.maxSnapshotBytes || pages >= syncLimits.maxSnapshotPages) throw new ServerProtocolError("snapshotLimit");
			await sql.write("INSERT INTO sync_snapshot_pages(snapshot_uuid,page_index,payload) VALUES (?,?,?)", [id, pages++, text]);
			fragment = { aggregates: [], identities: [] }; size = 40;
		};
		const append = async (kind: "aggregates" | "identities", value: ServerAggregate | SnapshotIdentity) => {
			const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
			if (bytes + 40 > syncLimits.batchBytes || ++records > syncLimits.maxSnapshotRecords) throw new ServerProtocolError("snapshotLimit");
			if (size > 40 && size + bytes > target) await flush();
			if (kind === "aggregates") fragment.aggregates.push(value as ServerAggregate); else fragment.identities.push(value as SnapshotIdentity);
			size += bytes;
		};
		let after = "";
		while (true) {
			const roots = await sql.query<{ uuid: string; entity: SyncAggregate }>("SELECT uuid,entity FROM sync_identities WHERE uuid=aggregate_uuid AND uuid>? ORDER BY uuid LIMIT 256", [after]);
			if (!roots.length) break;
			for (const root of roots) { const value = await aggregateSnapshot(sql, root.entity, root.uuid); if (!value) throw new ServerProtocolError("DB_READ_FAILED"); await append("aggregates", value); }
			after = roots.at(-1)!.uuid;
		}
		after = "";
		while (true) {
			const rows = await sql.query<Identity>("SELECT uuid,entity,aggregate_uuid,version,deleted_at FROM sync_identities WHERE uuid>? ORDER BY uuid LIMIT 1000", [after]);
			if (!rows.length) break;
			for (const row of rows) await append("identities", { uuid: row.uuid, entity: row.entity, aggregateUuid: row.aggregate_uuid, version: row.version, deletedAt: row.deleted_at === null ? null : utcTimestamp(row.deleted_at, "deleted_at") });
			after = rows.at(-1)!.uuid;
		}
		if (size > 40 || pages === 0) await flush();
		await sql.write("UPDATE sync_snapshots SET page_count=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE) WHERE uuid=?", [pages, id]);
		return snapshotPage(sql, binding, id, 0);
	});
}
export async function readServerChanges(db: ServerDatabase, input: unknown, cursor: unknown, limit = 10, targetBytes?: number): Promise<ChangePage> {
	const binding = readBinding(input), after = cursorNumber(cursor), target = pageBytes(targetBytes);
	if (!Number.isInteger(limit) || limit < 1 || limit > syncLimits.maxPullBatches) throw new ServerProtocolError("invalidRequest");
	return readTransaction(db, async (sql) => {
		const state = await readServerState(sql); checkBinding(state, binding);
		if (after > state.last_cursor) throw new ServerProtocolError("cursorInvalid");
		if (after > 0) {
			const end = (await sql.query<{ batch_uuid: string }>("SELECT batch_uuid FROM change_log WHERE change_cursor=?", [after]))[0];
			if (!end || (await sql.query<{ n: number }>("SELECT MAX(change_cursor) AS n FROM change_log WHERE batch_uuid=?", [end.batch_uuid]))[0]!.n !== after) throw new ServerProtocolError("cursorInvalid");
		}
		const groups = await sql.query<{ batch_uuid: string; first: number; last: number; n: number }>("SELECT batch_uuid,MIN(change_cursor) AS first,MAX(change_cursor) AS last,COUNT(*) AS n FROM change_log WHERE change_cursor>? GROUP BY batch_uuid ORDER BY first LIMIT ?", [after, limit]);
		const batches: ChangeBatch[] = []; let size = 0, next = after;
		for (const group of groups) {
			if (group.first !== next + 1 || group.last > state.last_cursor || group.n !== group.last - group.first + 1) throw new ServerProtocolError("cursorInvalid");
			const rows = await sql.query<{ change_cursor: number; payload: string; entity: SyncAggregate; entity_uuid: string; version: number }>("SELECT change_cursor,payload,entity,entity_uuid,version FROM change_log WHERE batch_uuid=? ORDER BY change_cursor", [group.batch_uuid]);
			const changes = rows.map((row) => {
				const value = storedJson<ServerAggregate>(row.payload);
				if (!validAggregate(value) || value.id !== row.entity_uuid || value.entity !== row.entity || value.version !== row.version) throw new ServerProtocolError("DB_READ_FAILED");
				return { cursor: String(row.change_cursor), aggregate: value };
			});
			const batch: ChangeBatch = { batchId: group.batch_uuid, firstCursor: String(group.first), lastCursor: String(group.last), changes };
			const bytes = Buffer.byteLength(JSON.stringify(batch));
			if (bytes > syncLimits.batchBytes) throw new ServerProtocolError("batchTooLarge");
			if (batches.length && size + bytes > target) break;
			batches.push(batch); size += bytes; next = group.last;
		}
		if (next === after && after < state.last_cursor) throw new ServerProtocolError("cursorInvalid");
		return { ...binding, protocolVersion: syncProtocolVersion, fromCursor: String(after), cursor: String(next), highWaterCursor: String(state.last_cursor), hasMore: next < state.last_cursor, batches };
	});
}
export async function readDeletionPreview(db: ServerDatabase, input: unknown, entity: SyncAggregate, id: string) {
	const binding = readBinding(input);
	if (!aggregates.includes(entity) || !isUuid(id)) throw new ServerProtocolError("invalidRequest");
	return readTransaction(db, async (sql) => {
		checkBinding(await readServerState(sql), binding);
		return { ...binding, root: await aggregateSnapshot(sql, entity, id), dependents: await Promise.all((await deletionDependents(sql, entity, id)).map((row) => aggregateSnapshot(sql, row.entity, row.uuid))) };
	});
}
