import type { ServerAggregate } from "../../shared/domain/server";
import { ServerWriteError } from "../../shared/domain/server";
import type { SyncAggregate, SyncEntity } from "../../shared/domain/sync";
import type { ServerDatabase, ServerSql } from "../database/connection";
import { serverTables, tableStatements, type ServerTable } from "../database/schema";
import { sqlTimestamp, utcTimestamp } from "./validation";

export type Identity = { uuid: string; entity: SyncEntity; aggregate_uuid: string; version: number; deleted_at: string | null };
export const identity = async (sql: ServerSql, uuid: string) => (await sql.query<Identity>("SELECT uuid,entity,aggregate_uuid,version,deleted_at FROM sync_identities WHERE uuid=?", [uuid]))[0] ?? null;
export async function reserveIdentity(sql: ServerSql, uuid: string, entity: SyncEntity, aggregateUuid: string) {
	const existing = await identity(sql, uuid);
	if (existing && (existing.entity !== entity || existing.aggregate_uuid !== aggregateUuid)) throw new ServerWriteError("identityConflict");
	if (!existing) await sql.write("INSERT INTO sync_identities(uuid,entity,aggregate_uuid) VALUES (?,?,?)", [uuid, entity, aggregateUuid]);
	return existing;
}
function payloadRow(row: Record<string, unknown>, table: ServerTable) {
	const result: Record<string, unknown> = { id: row.uuid };
	for (const field of serverTables[table].columns) result[field] = field !== "logged_at" && field.endsWith("_at") && row[field] !== null ? utcTimestamp(row[field], field) : row[field];
	return result;
}
export async function aggregateSnapshot(sql: ServerSql, entity: SyncAggregate, uuid: string): Promise<ServerAggregate | null> {
	const meta = await identity(sql, uuid);
	if (!meta || meta.entity !== entity) return null;
	if (meta.deleted_at !== null) return { entity, id: uuid, version: meta.version, deletedAt: utcTimestamp(meta.deleted_at, "deleted_at"), data: null };
	const row = (await sql.query(tableStatements[entity].select, [uuid]))[0];
	if (!row) throw new Error("Missing active aggregate row.");
	const data = payloadRow(row, entity);
	if (entity === "recipes") data.ingredients = (await sql.query("SELECT * FROM recipe_ingredients WHERE recipe_id=? AND deleted_at IS NULL ORDER BY view_id", [uuid])).map((child) => payloadRow(child, "recipe_ingredients"));
	if (entity === "meal_logs") data.profiles = (await sql.query("SELECT * FROM meal_log_profiles WHERE meal_log_id=? AND deleted_at IS NULL ORDER BY view_id", [uuid])).map((child) => payloadRow(child, "meal_log_profiles"));
	return { entity, id: uuid, version: meta.version, deletedAt: null, data };
}
export const readServerAggregate = (database: ServerDatabase, entity: SyncAggregate, uuid: string) => database.transaction((sql) => aggregateSnapshot(sql, entity, uuid));

export async function upsertRow(sql: ServerSql, table: ServerTable, data: Record<string, unknown>) {
	const previous = (await sql.query<Record<string, unknown>>(tableStatements[table].select, [data.id]))[0];
	const values = serverTables[table].columns.map((field) => {
		// Replay older immutable requests without clearing a subsequently added
		// field. Explicit null still deliberately removes the portion size.
		const value = field === "portion_size_grams" && data[field] === undefined ? previous?.[field] ?? null : data[field];
		return value !== null && field !== "logged_at" && field.endsWith("_at") ? sqlTimestamp(String(value)) : value;
	});
	// ON DUPLICATE KEY UPDATE would also match another row's unique EAN
	// or portion key. Target ONLY this UUID; let other uniqueness collisions fail.
	const exists = !!previous;
	await sql.write(exists ? tableStatements[table].update : tableStatements[table].insert, exists ? [...values, null, data.id] : [data.id, ...values, null]);
	await sql.write("UPDATE sync_identities SET deleted_at=NULL WHERE uuid=?", [data.id]);
}
export async function removeRow(sql: ServerSql, table: ServerTable, uuid: string, timestamp: string, child = false) {
	await sql.write(tableStatements[table].remove, [timestamp, uuid]);
	await sql.write(child ? "UPDATE sync_identities SET deleted_at=?,version=version+1 WHERE uuid=?" : "UPDATE sync_identities SET deleted_at=? WHERE uuid=?", [timestamp, uuid]);
}
export async function activeChildren(sql: ServerSql, table: "recipe_ingredients" | "meal_log_profiles", parent: string) {
	return sql.query<{ uuid: string }>(table === "recipe_ingredients" ? "SELECT uuid FROM recipe_ingredients WHERE recipe_id=? AND deleted_at IS NULL" : "SELECT uuid FROM meal_log_profiles WHERE meal_log_id=? AND deleted_at IS NULL", [parent]);
}
export async function replaceChildren(sql: ServerSql, table: "recipe_ingredients" | "meal_log_profiles", parent: string, children: Record<string, unknown>[], timestamp: string) {
	const ids = new Set(children.map((child) => String(child.id)));
	const previous = await activeChildren(sql, table, parent);
	// Free active membership keys first so atomic profile swaps/replacements
	// do not depend on input order. Unchanged UUIDs are reactivated below.
	if (table === "meal_log_profiles") for (const old of previous) await sql.write(tableStatements[table].remove, [timestamp, old.uuid]);
	for (const old of previous) if (!ids.has(old.uuid)) await removeRow(sql, table, old.uuid, timestamp, true);
	for (const child of children) {
		await reserveIdentity(sql, String(child.id), table, parent);
		await upsertRow(sql, table, child);
		await sql.write("UPDATE sync_identities SET version=version+1 WHERE uuid=?", [child.id]);
	}
}

export async function deletionDependents(sql: ServerSql, entity: SyncAggregate, uuid: string): Promise<{ entity: SyncAggregate; uuid: string }[]> {
	const result: { entity: SyncAggregate; uuid: string }[] = [];
	if (entity === "foods" || entity === "recipes") {
		const statement = entity === "foods"
			? "SELECT DISTINCT r.uuid FROM recipes r JOIN recipe_ingredients i ON i.recipe_id=r.uuid WHERE r.deleted_at IS NULL AND i.deleted_at IS NULL AND i.food_id=?"
			: "SELECT DISTINCT r.uuid FROM recipes r JOIN recipe_ingredients i ON i.recipe_id=r.uuid WHERE r.deleted_at IS NULL AND i.deleted_at IS NULL AND i.sub_recipe_id=?";
		for (const row of await sql.query<{ uuid: string }>(statement, [uuid])) result.push({ entity: "recipes", uuid: row.uuid });
		const meals = await sql.query<{ uuid: string }>(entity === "foods" ? "SELECT uuid FROM meal_logs WHERE food_id=? AND deleted_at IS NULL" : "SELECT uuid FROM meal_logs WHERE recipe_id=? AND deleted_at IS NULL", [uuid]);
		for (const row of meals) result.push({ entity: "meal_logs", uuid: row.uuid });
	} else if (entity === "profiles") {
		const meals = await sql.query<{ uuid: string }>("SELECT DISTINCT m.uuid FROM meal_logs m JOIN meal_log_profiles p ON p.meal_log_id=m.uuid WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND p.profile_id=?", [uuid]);
		for (const row of meals) result.push({ entity: "meal_logs", uuid: row.uuid });
	}
	return result;
}
export function previewServerDeletion(database: ServerDatabase, entity: SyncAggregate, uuid: string) {
	return database.transaction(async (sql) => ({ root: await aggregateSnapshot(sql, entity, uuid), dependents: await Promise.all((await deletionDependents(sql, entity, uuid)).map((row) => aggregateSnapshot(sql, row.entity, row.uuid))) }));
}
