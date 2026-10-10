import { createHash } from "node:crypto";
import { ServerWriteError, type ServerAggregate, type ServerGuard, type ServerReceipt, type ServerWriteBatch } from "../../shared/domain/server";
import type { SyncAggregate } from "../../shared/domain/sync";
import { ServerProtocolError, syncLimits } from "../../shared/domain/protocol";
import { DomainValidationError, fail, validateRecipeGraph } from "../../shared/domain/validation";
import type { ServerDatabase, ServerSql } from "../database/connection";
import { readServerState } from "../database/state";
import { aggregateSnapshot, activeChildren, deletionDependents, identity, removeRow, replaceChildren, reserveIdentity, upsertRow } from "./storage";
import { aggregates, normalizeWriteBatch, sqlTimestamp } from "./validation";
import { hasDeletionHistory, recipeDeletionSet } from './deletion-history';

export class ServerStorageError extends Error {
	readonly code = "DB_WRITE_FAILED";
	constructor() { super("Server write could not be committed."); this.name = "ServerStorageError"; }
}
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
function canonical(value: unknown): JsonValue {
	if (Array.isArray(value)) return value.map(canonical);
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
	if (typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
	fail("invalidType", "batch");
}
function requestHash(batch: ServerWriteBatch) { return createHash("sha256").update(JSON.stringify(canonical(batch))).digest("hex"); }
async function checkRevision(sql: ServerSql, target: ServerGuard, dependency = false) {
	const meta = await identity(sql, target.entityUuid);
	if (meta && (meta.entity !== target.entity || meta.aggregate_uuid !== meta.uuid)) throw new ServerWriteError("identityConflict");
	if ((meta?.version ?? 0) !== target.baseRevision) {
		const current = await aggregateSnapshot(sql, target.entity, target.entityUuid);
		throw new ServerWriteError(dependency ? "dependencyConflict" : "versionConflict", current ? [current] : []);
	}
}
async function checkReferences(sql: ServerSql, batch: ServerWriteBatch) {
	const proposed = new Map(batch.operations.map((operation) => [operation.entityUuid, operation]));
	const check = async (uuid: unknown, expected: SyncAggregate, field: string) => {
		if (uuid === null) return;
		const next = proposed.get(String(uuid));
		if (next?.entity === expected && next.operation === "upsert") return;
		if (next?.operation === "delete") fail("reference", field);
		const meta = await identity(sql, String(uuid));
		if (!meta || meta.entity !== expected) fail("reference", field);
		if (meta.deleted_at !== null) {
			const current = await aggregateSnapshot(sql, expected, String(uuid));
			throw new ServerWriteError("dependencyConflict", current ? [current] : []);
		}
	};
	for (const operation of batch.operations) {
		if (operation.operation !== "upsert") continue;
		const payload = operation.payload;
		if (operation.entity === "recipes") for (const child of payload.ingredients as Record<string, unknown>[]) {
			await check(child.food_id, "foods", "food_id"); await check(child.sub_recipe_id, "recipes", "sub_recipe_id");
		}
		if (operation.entity === 'activity_logs') await check(payload.profile_id, 'profiles', 'profile_id');
		if (operation.entity === "meal_logs") {
			await check(payload.food_id, "foods", "food_id"); await check(payload.recipe_id, "recipes", "recipe_id");
			for (const child of payload.profiles as Record<string, unknown>[]) await check(child.profile_id, "profiles", "profile_id");
		}
	}
}

async function commitBatch(sql: ServerSql, batch: ServerWriteBatch): Promise<ServerReceipt> {
	// One household: serialize ALL service writes using this row, held until
	// commit. This prevents concurrent graph/EAN races and assigns cursors in
	// actual commit order, rather than unsafe auto-increment allocation order.
	const state = await readServerState(sql, true);
	if (state.instance_uuid !== batch.serverInstanceId || state.epoch_uuid !== batch.serverEpoch) throw new ServerWriteError("serverChanged");
	const hash = requestHash(batch);
	const replay = (await sql.query<{ request_hash: string; receipt_json: string }>("SELECT request_hash,receipt_json FROM write_batches WHERE uuid=?", [batch.batchId]))[0];
	if (replay) {
		if (replay.request_hash !== hash) throw new ServerWriteError("idempotencyConflict");
		try { return JSON.parse(replay.receipt_json) as ServerReceipt; } catch { throw new ServerStorageError(); }
	}
	for (const operation of batch.operations) {
		if ((await sql.query("SELECT uuid FROM write_operations WHERE uuid=?", [operation.operationId])).length) throw new ServerWriteError("idempotencyConflict");
		await checkRevision(sql, operation);
	}
	for (const guard of batch.guards ?? []) await checkRevision(sql, guard, true);
	const guarded = new Map([...batch.operations, ...batch.guards ?? []].map((item) => [item.entityUuid, item]));
	for (const operation of batch.operations) if (operation.operation === "delete") {
		const unguarded: ServerAggregate[] = [];
		for (const dependent of await deletionDependents(sql, operation.entity, operation.entityUuid)) {
			const guard = guarded.get(dependent.uuid);
			if (!guard || guard.entity !== dependent.entity) {
				const current = await aggregateSnapshot(sql, dependent.entity, dependent.uuid);
				if (current) unguarded.push(current);
			}
		}
		if (unguarded.length) throw new ServerWriteError("dependencyConflict", unguarded);
	}
	if (batch.preserveHistory) for (const operation of batch.operations) if (operation.operation === 'delete') {
		const affected = await recipeDeletionSet(sql,operation.entity,operation.entityUuid);
		for (const uuid of affected) if (uuid !== operation.entityUuid && guarded.get(uuid)?.entity !== 'recipes') {
			const current = await aggregateSnapshot(sql,'recipes',uuid);
			throw new ServerWriteError('dependencyConflict',current ? [current] : []);
		}
		if (await hasDeletionHistory(sql,operation.entity,operation.entityUuid,affected)) throw new ServerWriteError('historyConflict');
	}
	await checkReferences(sql, batch);
	const timestamp = sqlTimestamp(new Date().toISOString());
	const dirty = new Map<string, SyncAggregate>();
	for (const operation of batch.operations) {
		await reserveIdentity(sql, operation.entityUuid, operation.entity, operation.entityUuid);
		dirty.set(operation.entityUuid, operation.entity);
		// Free active EANs before full replacement: atomic EAN swaps and a
		// delete/recreate in the same transaction must not depend on order.
		if (operation.entity === "foods" && operation.operation === "upsert") await sql.write("UPDATE foods SET ean=NULL WHERE uuid=?", [operation.entityUuid]);
		if (operation.operation === "delete") await removeRow(sql, operation.entity, operation.entityUuid, timestamp);
	}
	// Materialize all roots before their children; recipes may refer to another
	// recipe supplied later in the same batch. Validate the FINAL graph below.
	for (const entity of aggregates) for (const operation of batch.operations) if (operation.entity === entity && operation.operation === "upsert") await upsertRow(sql, entity, operation.payload);
	for (const operation of batch.operations) if (operation.operation === "upsert") {
		if (operation.entity === "recipes") await replaceChildren(sql, "recipe_ingredients", operation.entityUuid, operation.payload.ingredients as Record<string, unknown>[], timestamp);
		if (operation.entity === "meal_logs") await replaceChildren(sql, "meal_log_profiles", operation.entityUuid, operation.payload.profiles as Record<string, unknown>[], timestamp);
	}
	const removeMeal = async (uuid: string) => {
		for (const child of await activeChildren(sql, "meal_log_profiles", uuid)) await removeRow(sql, "meal_log_profiles", child.uuid, timestamp, true);
		await removeRow(sql, "meal_logs", uuid, timestamp); dirty.set(uuid, "meal_logs");
	};
	for (const operation of batch.operations) if (operation.operation === "delete") {
		if (operation.entity === "meal_logs") await removeMeal(operation.entityUuid);
		if (operation.entity === "recipes") for (const child of await activeChildren(sql, "recipe_ingredients", operation.entityUuid)) await removeRow(sql, "recipe_ingredients", child.uuid, timestamp, true);
		if (operation.entity === "foods" || operation.entity === "recipes") {
			const children = await sql.query<{ uuid: string; recipe_id: string }>(operation.entity === "foods"
				? "SELECT i.uuid,i.recipe_id FROM recipe_ingredients i JOIN recipes r ON r.uuid=i.recipe_id WHERE i.food_id=? AND i.deleted_at IS NULL AND r.deleted_at IS NULL"
				: "SELECT i.uuid,i.recipe_id FROM recipe_ingredients i JOIN recipes r ON r.uuid=i.recipe_id WHERE i.sub_recipe_id=? AND i.deleted_at IS NULL AND r.deleted_at IS NULL", [operation.entityUuid]);
			for (const child of children) {
				await removeRow(sql, "recipe_ingredients", child.uuid, timestamp, true);
				await sql.write("UPDATE recipes SET updated_at=? WHERE uuid=?", [timestamp, child.recipe_id]); dirty.set(child.recipe_id, "recipes");
			}
			const meals = await sql.query<{ uuid: string }>(operation.entity === "foods" ? "SELECT uuid FROM meal_logs WHERE food_id=? AND deleted_at IS NULL" : "SELECT uuid FROM meal_logs WHERE recipe_id=? AND deleted_at IS NULL", [operation.entityUuid]);
			for (const meal of meals) await removeMeal(meal.uuid);
		}
		if (operation.entity === "profiles") {
			for (const log of await sql.query<{ uuid: string }>('SELECT uuid FROM activity_logs WHERE profile_id=? AND deleted_at IS NULL', [operation.entityUuid])) {
				await removeRow(sql, 'activity_logs', log.uuid, timestamp); dirty.set(log.uuid, 'activity_logs');
			}
			const portions = await sql.query<{ uuid: string; meal_log_id: string }>("SELECT p.uuid,p.meal_log_id FROM meal_log_profiles p JOIN meal_logs m ON m.uuid=p.meal_log_id WHERE p.profile_id=? AND p.deleted_at IS NULL AND m.deleted_at IS NULL", [operation.entityUuid]);
			for (const portion of portions) {
				await removeRow(sql, "meal_log_profiles", portion.uuid, timestamp, true);
				await sql.write("UPDATE meal_logs SET updated_at=? WHERE uuid=?", [timestamp, portion.meal_log_id]); dirty.set(portion.meal_log_id, "meal_logs");
			}
		}
	}
	const edges = await sql.query<{ recipeId: string; subRecipeId: string | null }>("SELECT i.recipe_id AS recipeId,i.sub_recipe_id AS subRecipeId FROM recipe_ingredients i JOIN recipes r ON r.uuid=i.recipe_id WHERE i.deleted_at IS NULL AND r.deleted_at IS NULL");
	validateRecipeGraph(edges);
	const snapshots: ServerAggregate[] = []; let changeBytes = 200;
	for (const [uuid, entity] of dirty) {
		const meta = await identity(sql, uuid);
		if (!meta || !Number.isSafeInteger(meta.version + 1)) throw new ServerStorageError();
		await sql.write("UPDATE sync_identities SET version=version+1 WHERE uuid=?", [uuid]);
		const snapshot = await aggregateSnapshot(sql, entity, uuid);
		if (!snapshot) throw new ServerStorageError();
		// Bound the WHOLE atomic change batch, including implicit cascades.
		// Otherwise pull could never transmit it without splitting dependencies.
		changeBytes += Buffer.byteLength(JSON.stringify(snapshot)) + 64;
		if (changeBytes > syncLimits.batchBytes) throw new ServerProtocolError("batchTooLarge");
		snapshots.push(snapshot);
	}
	const cursor = state.last_cursor + snapshots.length;
	if (!Number.isSafeInteger(cursor)) throw new ServerStorageError();
	const revisions = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.version]));
	const receipt: ServerReceipt = {
		batchId: batch.batchId, serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid, cursor: String(cursor),
		operations: batch.operations.map((operation) => ({ operationId: operation.operationId, entity: operation.entity, entityUuid: operation.entityUuid, serverRevision: revisions.get(operation.entityUuid)! })),
		changes: snapshots.map((snapshot) => ({ entity: snapshot.entity, entityUuid: snapshot.id, serverRevision: snapshot.version })),
	};
	if (batch.deviceId) await sql.write("INSERT INTO sync_devices(uuid) VALUES (?) ON DUPLICATE KEY UPDATE last_seen=UTC_TIMESTAMP(3)", [batch.deviceId]);
	await sql.write("INSERT INTO write_batches(uuid,device_uuid,request_hash,receipt_json) VALUES (?,?,?,?)", [batch.batchId, batch.deviceId ?? null, hash, JSON.stringify(receipt)]);
	for (const operation of batch.operations) await sql.write("INSERT INTO write_operations(uuid,batch_uuid,entity,entity_uuid,base_revision,server_revision) VALUES (?,?,?,?,?,?)", [operation.operationId, batch.batchId, operation.entity, operation.entityUuid, operation.baseRevision, revisions.get(operation.entityUuid)!]);
	for (let index = 0; index < snapshots.length; index++) {
		const snapshot = snapshots[index]!;
		await sql.write("INSERT INTO change_log(change_cursor,batch_uuid,entity,entity_uuid,version,payload) VALUES (?,?,?,?,?,?)", [state.last_cursor + index + 1, batch.batchId, snapshot.entity, snapshot.id, snapshot.version, JSON.stringify(snapshot)]);
	}
	await sql.write("UPDATE server_state SET last_cursor=? WHERE id=1", [cursor]);
	return receipt;
}

export async function writeServerBatch(database: ServerDatabase, input: unknown): Promise<ServerReceipt> {
	const batch = normalizeWriteBatch(input);
	try { return await database.transaction((sql) => commitBatch(sql, batch)); }
	catch (error) {
		if (error instanceof ServerWriteError || error instanceof DomainValidationError || error instanceof ServerStorageError || error instanceof ServerProtocolError) throw error;
		if (error !== null && typeof error === "object" && "errno" in error && error.errno === 1062) fail("duplicate", "ean");
		// SQL driver errors can contain statements and parameter values. Never
		// propagate those to future HTTP responses/logs.
		throw new ServerStorageError();
	}
}
