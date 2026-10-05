import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import type { ServerDatabase } from "../../server/database/connection";
import { newDatabase, resetDatabase, testConfig } from "./helpers";

async function unusedPort() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address(); if (!address || typeof address === "string") throw new Error("No test HTTP port.");
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return address.port;
}

describe("built Nitro backend health and private configuration", () => {
	let database: ServerDatabase, child: ChildProcess, base: string; let logs = "";
	beforeAll(async () => {
		database = newDatabase(); await resetDatabase(database, false);
		const config = testConfig(); const port = await unusedPort(); base = `http://127.0.0.1:${port}`;
		child = spawn(process.execPath, [".output/server/index.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: {
			...process.env, NITRO_HOST: "127.0.0.1", NITRO_PORT: String(port),
			NUXT_MARIA_DB_HOST: config.host, NUXT_MARIA_DB_PORT: String(config.port), NUXT_MARIA_DB_USER: config.user,
			NUXT_MARIA_DB_PASSWORD: config.password, NUXT_MARIA_DB_DATABASE: config.database, NUXT_MARIA_DB_CONNECTION_LIMIT: "3",
		} });
		child.stdout?.on("data", (value) => { logs += String(value); }); child.stderr?.on("data", (value) => { logs += String(value); });
		for (let attempt = 0; attempt < 100; attempt++) {
			if (child.exitCode !== null) throw new Error("Built backend exited before becoming ready (check sanitized startup logs).");
			try { const response = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(1000) }); if (response.status === 200) return; } catch { /* startup still in progress */ }
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("Built backend did not become ready.");
	});
	afterAll(async () => {
		if (child && child.exitCode === null && child.signalCode === null) {
			const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM");
			const force = setTimeout(() => { child.kill("SIGKILL"); }, 6000);
			try { await exited; } finally { clearTimeout(force); }
		}
		if (database) await database.close();
	});
	it("migrates on actual server startup and exposes live/ready endpoints", async () => {
		const live = await fetch(`${base}/api/health/live`); expect(live.status).toBe(200); expect(await live.json()).toEqual({ status: "ok" });
		const ready = await fetch(`${base}/api/health/ready`); expect(ready.status).toBe(200); expect(await ready.json()).toEqual({ status: "ready" });
		expect(await database.withConnection((sql) => sql.query("SELECT version,status FROM schema_migrations"))).toEqual([{ version: 1, status: "applied" }]);
	});
	it("does not expose private credentials in HTML, health responses or startup logs", async () => {
		const secret = testConfig().password;
		const html = await (await fetch(base)).text(); const health = await (await fetch(`${base}/api/health/ready`)).text();
		expect(html).not.toContain(secret); expect(health).not.toContain(secret); expect(logs).not.toContain(secret);
		expect(html).not.toContain('"mariaDb"');
		for (const file of readdirSync(".output/public/_nuxt").filter((name) => name.endsWith(".js"))) expect(readFileSync(`.output/public/_nuxt/${file}`, "utf8")).not.toContain(secret);
	});
	it("returns sanitized readiness failures without taking liveness down", async () => {
		await database.withConnection((sql) => sql.write("UPDATE schema_migrations SET status='applying' WHERE version=1"));
		try {
			const ready = await fetch(`${base}/api/health/ready`); expect(ready.status).toBe(503); expect(await ready.json()).toEqual({ status: "unavailable", code: "DB_NOT_READY" });
			expect((await fetch(`${base}/api/health/live`)).status).toBe(200);
			expect(logs).not.toContain(testConfig().password);
		} finally { await database.withConnection((sql) => sql.write("UPDATE schema_migrations SET status='applied' WHERE version=1")); }
	});
});
