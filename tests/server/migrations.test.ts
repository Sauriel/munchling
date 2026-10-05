import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServerDatabase, ServerSql } from "../../server/database/connection";
import { migrateServerDatabase, migrationChecksum } from "../../server/database/migrations";
import { serverMigrations } from "../../server/database/schema";
import { readServerState } from "../../server/database/state";
import { isUuid } from "../../shared/domain/sync";
import { newDatabase, resetDatabase } from "./helpers";

describe("real MariaDB migrations and transaction foundation", () => {
	let database: ServerDatabase;
	beforeAll(() => { database = newDatabase(); });
	beforeEach(async () => { await resetDatabase(database, false); });
	afterAll(async () => { await database.close(); });
	it("creates all tables and stable server identity with a checksummed migration", async () => {
		await migrateServerDatabase(database, "munchling_test");
		const state = await database.withConnection((sql) => readServerState(sql));
		expect(isUuid(state.instance_uuid) && isUuid(state.epoch_uuid)).toBe(true);
		expect(state.last_cursor).toBe(0);
		expect(await database.withConnection((sql) => sql.query("SELECT version,status,checksum FROM schema_migrations"))).toEqual([{ version: 1, status: "applied", checksum: migrationChecksum(serverMigrations[0]!.statements) }]);
		await migrateServerDatabase(database, "munchling_test");
		expect(await database.withConnection((sql) => readServerState(sql))).toEqual(state);
	});
	it("serializes concurrent startup migrations", async () => {
		await Promise.all([migrateServerDatabase(database, "munchling_test"), migrateServerDatabase(database, "munchling_test")]);
		expect(await database.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM schema_migrations"))).toEqual([{ n: 1 }]);
	});
	it("refuses changed checksums and future schema versions", async () => {
		await migrateServerDatabase(database, "munchling_test");
		await database.withConnection((sql) => sql.write("UPDATE schema_migrations SET checksum=? WHERE version=1", ["0".repeat(64)]));
		await expect(migrateServerDatabase(database, "munchling_test")).rejects.toThrow("checksum");
		await database.withConnection((sql) => sql.write("UPDATE schema_migrations SET checksum=? WHERE version=1", [migrationChecksum(serverMigrations[0]!.statements)]));
		await database.withConnection((sql) => sql.write("INSERT INTO schema_migrations(version,name,checksum,status) VALUES (99,'future',?,'applied')", ["0".repeat(64)]));
		await expect(migrateServerDatabase(database, "munchling_test")).rejects.toThrow("newer");
	});
	it("records implicit-DDL failure and refuses to pretend an incomplete migration succeeded", async () => {
		const broken = [{ version: 1, name: "broken", statements: ["CREATE TABLE server_state(id INT PRIMARY KEY)", "INSERT INTO definitely_missing VALUES(1)"] }];
		await expect(migrateServerDatabase(database, "munchling_test", broken)).rejects.toThrow();
		expect(await database.withConnection((sql) => sql.query("SELECT status FROM schema_migrations"))).toEqual([{ status: "applying" }]);
		await expect(migrateServerDatabase(database, "munchling_test", broken)).rejects.toThrow("Incomplete");
	});
	it("invalidates scoped executors after releasing their connection", async () => {
		let scoped!: ServerSql;
		await database.withConnection(async (sql) => { scoped = sql; });
		await expect(scoped.query("SELECT 1 AS n")).rejects.toThrow("no longer active");
		await database.transaction(async (sql) => { scoped = sql; });
		await expect(scoped.write("SELECT 1 AS n")).rejects.toThrow("no longer active");
	});

	it("rolls back household cursor changes and releases connections for another transaction", async () => {
		await migrateServerDatabase(database, "munchling_test");
		await expect(database.transaction(async (sql) => { await readServerState(sql, true); await sql.write("UPDATE server_state SET last_cursor=7 WHERE id=1"); throw new Error("failed"); })).rejects.toThrow("failed");
		expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(0);
		await database.transaction(async (sql) => { await readServerState(sql, true); await sql.write("UPDATE server_state SET last_cursor=1 WHERE id=1"); });
		expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(1);
	});
});
