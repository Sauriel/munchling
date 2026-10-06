import { afterEach, describe, expect, it, vi } from "vitest";
import { splitSqlStatements, createSqlScriptExecutor } from "../../app/utils/database/script";
import { createSqlDatabase } from "../../app/utils/database/executor";
import { runLocalMigrations } from "../../app/utils/database/migrations";
import { schemaMigrations } from "../../app/utils/database/schema";
import { createLocalDataService } from "../../app/utils/data/local";
import { flushOutbox } from "../../app/utils/database/outbox";
import { createTestDatabase } from "../helpers/sqlite";
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => opened.splice(0).forEach(db => db.close()));
describe("native single-statement script execution", () => {
	it("keeps semicolons, comments, quoted identifiers and nested CASE inside complete trigger bodies", () => {
		const trigger = `CREATE TEMP TRIGGER "tr; END" AFTER INSERT ON [t] BEGIN
INSERT INTO t VALUES ('semi; -- still literal ''END''');
SELECT CASE WHEN 1 THEN CASE WHEN 1 THEN 'END;' END ELSE 'BEGIN' END;
/* ; END; */ UPDATE t SET [v] = "semi; END";
END;`;
		const script = `-- BEGIN;\nCREATE TABLE [t](v TEXT);\n${trigger}\nINSERT INTO t VALUES ('after;'); -- END;`;
		expect(splitSqlStatements(script)).toEqual(["-- BEGIN;\nCREATE TABLE [t](v TEXT);", trigger, "INSERT INTO t VALUES ('after;');"]);
		expect(splitSqlStatements(" -- nothing;\n/* END; */")).toEqual([]);
		expect(splitSqlStatements('CREATE TABLE `a;b` ("x" TEXT); INSERT INTO `a;b` VALUES (\'quoted\'\'semi;\');')).toHaveLength(2);
	});
	it("rejects malformed boundaries before any SQL or transaction starts", async () => {
		const driver = { run: vi.fn(async () => ({})), begin: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) }, execute = createSqlScriptExecutor(driver);
		for (const script of ["CREATE TABLE t(v TEXT); SELECT 'unfinished", "CREATE TABLE t(v); /* unfinished", "CREATE TRIGGER t AFTER INSERT ON x BEGIN SELECT CASE WHEN 1 THEN 2 END;"]) await expect(execute(script)).rejects.toThrow("Unterminated SQL");
		expect(driver.run).not.toHaveBeenCalled(); expect(driver.begin).not.toHaveBeenCalled();
	});
	it("applies published v1/v2/v3 and additive v4 without rewriting DDL and preserves legacy rows through a native-like bridge", async () => {
		const db = await createTestDatabase({ version: 1 }); opened.push(db);
		const p = await db.service.profiles.createProfile({ name: "Legacy", dailyCaloriesTarget: 2100 });
		const f = await db.service.foods.createFood({ nameDe: "Food", nameEn: "Food", caloriesPer100g: 100, fatPer100g: 0, carbsPer100g: 10, sugarPer100g: 0, proteinPer100g: 0, fiberPer100g: 0, saltPer100g: 0 });
		const r = await db.service.recipes.createRecipe({ nameDe: "Recipe", nameEn: "Recipe", ingredients: [{ foodId: f!.id, amountGrams: 12.5 }] });
		await db.service.mealLogs.createMealLog({ loggedAt: "2019-01-02 03:04", recipeId: r!.id, profiles: [{ profileId: p!.id, portionGrams: 33.3 }] });
		const before = (await db.service.backups!.exportBackup()).data, save = vi.fn(async () => {}), run = vi.fn(db.driver.run), native = { ...db.driver, run, execute: createSqlScriptExecutor({ ...db.driver, run }) };
		await runLocalMigrations(createSqlDatabase(native), save); expect(save).toHaveBeenCalledOnce();
		const after = createLocalDataService(createSqlDatabase(native, flushOutbox)); expect((await after.backups!.exportBackup()).data).toEqual(before);
		expect((await db.database.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version;"))).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
		const triggers = run.mock.calls.map(call => call[0]).filter(sql => /CREATE TRIGGER/.test(sql)); expect(triggers.length).toBeGreaterThan(20); expect(triggers.every(sql => /END;\s*$/.test(sql))).toBe(true);
		await after.foods.updateFood(f!.id, { brand: "Updated" }); expect((await db.database.query<{ count: number }>("SELECT COUNT(*) AS count FROM sync_outbox;"))[0]!.count).toBeGreaterThan(0);
		await expect(db.database.run("UPDATE foods SET uuid=? WHERE id=?;", ["other", f!.id])).rejects.toThrow("UUID is immutable");
		for (const migration of schemaMigrations) expect(splitSqlStatements(migration.statements).length).toBeGreaterThan(0);
	});
	it("rolls back late native trigger failure with backfill/marker/outbox intact and permits a safe retry", async () => {
		const db = await createTestDatabase({ version: 1 }); opened.push(db); await db.service.profiles.createProfile({ name: "Before", dailyCaloriesTarget: 1000 });
		const run = vi.fn(async (sql: string, values = []) => { if (sql.includes("CREATE TRIGGER sync_meal_log_profiles_update")) throw new Error("late trigger failure"); return db.driver.run(sql,values); });
		const native = { ...db.driver, run, execute: createSqlScriptExecutor({ ...db.driver, run }) }, safety = vi.fn(async () => {});
		await expect(runLocalMigrations(createSqlDatabase(native), safety)).rejects.toThrow("late trigger failure");
		expect((await db.database.query<{ version: number }>("SELECT version FROM schema_migrations;"))).toEqual([{ version: 1 }]); expect((await db.database.query<{ name: string }>("PRAGMA table_info(profiles);")).some(row => row.name === "uuid")).toBe(false); expect(await db.database.query("SELECT name FROM sqlite_master WHERE name='sync_outbox';")).toEqual([]);
		run.mockImplementation(db.driver.run); await runLocalMigrations(createSqlDatabase(native), safety); expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Before");
	});
	it("fences a rollback failure and does not roll back a transaction that never began", async () => {
		const run = vi.fn(async () => { throw new Error("SQL failure"); }), begin = vi.fn(async () => {}), rollback = vi.fn(async () => { throw new Error("rollback failure"); }), commit = vi.fn(async () => {}), execute = createSqlScriptExecutor({ run, begin, rollback, commit });
		await expect(execute("SELECT 1;")).rejects.toBeInstanceOf(AggregateError); await expect(execute("SELECT 2;")).rejects.toThrow("requires reopening"); expect(run).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
		const notStarted = createSqlScriptExecutor({ run, begin: async () => { throw new Error("begin failure"); }, rollback, commit }); await expect(notStarted("SELECT 1;")).rejects.toThrow("begin failure"); expect(rollback).toHaveBeenCalledOnce();
	});
	it("owns standalone transactions but never nests inside the migration executor", async () => {
		const db = await createTestDatabase(); opened.push(db); const begin = vi.fn(db.driver.begin), commit = vi.fn(db.driver.commit), rollback = vi.fn(db.driver.rollback), execute = createSqlScriptExecutor({ ...db.driver, begin, commit, rollback });
		await execute("CREATE TABLE probe(v TEXT); INSERT INTO probe VALUES ('one;');"); expect(begin).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce();
		await expect(execute("INSERT INTO probe VALUES ('two'); INSERT INTO missing VALUES (1);")).rejects.toThrow(); expect(rollback).toHaveBeenCalledOnce(); expect(await db.database.query("SELECT * FROM probe;")).toEqual([{ v: "one;" }]);
		begin.mockClear(); commit.mockClear(); await db.driver.begin(); await execute("INSERT INTO probe VALUES ('outer');", false); expect(begin).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); await db.driver.rollback(); expect(await db.database.query("SELECT * FROM probe;")).toEqual([{ v: "one;" }]);
	});
});
