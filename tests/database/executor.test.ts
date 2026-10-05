import { describe, expect, it, vi } from "vitest";
import { createSqlDatabase, type SqlDriver, type SqlExecutor } from "../../app/utils/database/executor";

function createDriver() {
	return {
		initialize: vi.fn(async () => {}),
		execute: vi.fn(async () => ({ changes: { changes: 1 } })),
		run: vi.fn(async () => ({ changes: { changes: 1, lastId: 1 } })),
		query: vi.fn(async () => []),
		begin: vi.fn(async () => {}),
		commit: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		persist: vi.fn(async () => {}),
	} satisfies SqlDriver;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

describe("serialized SQL executor", () => {
	it("persists only after all writes and commit", async () => {
		const driver = createDriver();
		const db = createSqlDatabase(driver);
		await db.transaction(async (sql) => {
			await sql.run("first");
			await sql.run("second");
			expect(driver.persist).not.toHaveBeenCalled();
		});
		expect(driver.begin).toHaveBeenCalledTimes(1);
		expect(driver.commit).toHaveBeenCalledTimes(1);
		expect(driver.persist).toHaveBeenCalledTimes(1);
		expect(driver.rollback).not.toHaveBeenCalled();
		expect(driver.commit.mock.invocationCallOrder[0]).toBeLessThan(driver.persist.mock.invocationCallOrder[0]!);
	});

	it("keeps unrelated reads and writes outside the transaction", async () => {
		const driver = createDriver();
		const db = createSqlDatabase(driver);
		const entered = deferred();
		const release = deferred();
		const transaction = db.transaction(async (sql) => {
			await sql.run("inside");
			entered.resolve();
			await release.promise;
		});
		await entered.promise;
		const outside = db.run("outside");
		const read = db.query("read outside");
		await Promise.resolve();
		expect(driver.run).toHaveBeenCalledTimes(1);
		expect(driver.query).not.toHaveBeenCalled();
		release.resolve();
		await Promise.all([transaction, outside, read]);
		expect(driver.run).toHaveBeenCalledTimes(2);
		expect(driver.commit.mock.invocationCallOrder[0]).toBeLessThan(driver.run.mock.invocationCallOrder[1]!);
		expect(driver.commit.mock.invocationCallOrder[0]).toBeLessThan(driver.query.mock.invocationCallOrder[0]!);
	});

	it("rolls back a failed callback and admits the next operation", async () => {
		const driver = createDriver();
		const db = createSqlDatabase(driver);
		await expect(db.transaction(async (sql) => {
			await sql.run("inside");
			throw new Error("failed");
		})).rejects.toThrow("failed");
		expect(driver.rollback).toHaveBeenCalledTimes(1);
		expect(driver.persist).not.toHaveBeenCalled();
		await db.run("next");
		expect(driver.run).toHaveBeenCalledTimes(2);
	});

	it("rolls back a failed commit", async () => {
		const driver = createDriver();
		driver.commit.mockRejectedValueOnce(new Error("commit failed"));
		await expect(createSqlDatabase(driver).transaction(async (sql) => sql.run("inside"))).rejects.toThrow("commit failed");
		expect(driver.rollback).toHaveBeenCalledTimes(1);
		expect(driver.persist).not.toHaveBeenCalled();
	});

	it("blocks subsequent access if rollback cannot clean the connection", async () => {
		const driver = createDriver();
		driver.rollback.mockRejectedValueOnce(new Error("rollback failed"));
		const db = createSqlDatabase(driver);
		await expect(db.transaction(async () => { throw new Error("failed"); })).rejects.toThrow("Transaction and rollback failed");
		await expect(db.run("next")).rejects.toThrow("needs reopening");
		expect(driver.run).not.toHaveBeenCalled();
	});

	it("does not attempt rollback after a successful commit but failed persistence", async () => {
		const driver = createDriver();
		driver.persist.mockRejectedValueOnce(new Error("store full"));
		await expect(createSqlDatabase(driver).transaction(async (sql) => sql.run("inside"))).rejects.toThrow("store full");
		expect(driver.commit).toHaveBeenCalledTimes(1);
		expect(driver.rollback).not.toHaveBeenCalled();
	});

	it("invalidates a scoped executor after the transaction finishes", async () => {
		const driver = createDriver();
		let scoped!: SqlExecutor;
		await createSqlDatabase(driver).transaction(async (sql) => { scoped = sql; });
		await expect(scoped.run("too late")).rejects.toThrow("no longer active");
		expect(driver.run).not.toHaveBeenCalled();
	});

	it("converts boolean bindings to SQLite-compatible integers", async () => {
		const driver = createDriver();
		const db = createSqlDatabase(driver);
		await db.run("outside", [true, false]);
		await db.transaction(async (sql) => sql.run("inside", [false, true]));
		expect(driver.run).toHaveBeenNthCalledWith(1, "outside", [1, 0]);
		expect(driver.run).toHaveBeenNthCalledWith(2, "inside", [0, 1]);
	});
});
