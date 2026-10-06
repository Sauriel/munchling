import { describe, it, expect } from "vitest";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { createUuid } from "../../shared/domain/sync";
import { createHttpDataService, type WebWriteLock } from "../../app/utils/data/http";
import { newDatabase, resetDatabase, testConfig } from "./helpers";
const command = promisify(execFile);
const lock: WebWriteLock = { run: async (_key, action) => action() };
function store() { const entries = new Map<string,string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key,value); }, removeItem: (key: string) => { entries.delete(key); } }; }
describe.skipIf(!process.env.MUNCHLING_TEST_IMAGE)("production Docker deployment", () => {
	it("runs non-root/read-only, serves editable web, retains MariaDB data on restart and shuts down cleanly", async () => {
		const database = await newDatabase(), config = testConfig(), name = `munchling-runtime-test-${createUuid()}`;
		try {
			await resetDatabase(database);
			const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0,"127.0.0.1",resolve)); const port = (reservation.address() as { port: number }).port; await new Promise<void>((resolve,reject) => reservation.close(error => error ? reject(error) : resolve()));
			const base = `http://127.0.0.1:${port}`, env = { ...process.env, NITRO_HOST: "127.0.0.1", NITRO_PORT: String(port), NUXT_SYNC_PUBLIC_ORIGIN: base, NUXT_MARIA_DB_HOST: config.host, NUXT_MARIA_DB_PORT: String(config.port), NUXT_MARIA_DB_USER: config.user, NUXT_MARIA_DB_PASSWORD: config.password, NUXT_MARIA_DB_DATABASE: config.database };
			const keys = ["NITRO_HOST", "NITRO_PORT", "NUXT_SYNC_PUBLIC_ORIGIN", "NUXT_MARIA_DB_HOST", "NUXT_MARIA_DB_PORT", "NUXT_MARIA_DB_USER", "NUXT_MARIA_DB_PASSWORD", "NUXT_MARIA_DB_DATABASE"];
			await command("docker", ["run", "-d", "--name", name, "--network", "host", "--read-only", "--tmpfs", "/tmp:rw,size=16m", ...keys.flatMap(key => ["--env", key]), process.env.MUNCHLING_TEST_IMAGE!], { env });
			async function ready() { const start = Date.now(); while (Date.now()-start < 45_000) { try { if ((await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve,250)); } throw new Error("Runtime readiness timeout"); }
			await ready(); expect((await command("docker", ["exec", name, "id", "-u"])).stdout.trim()).not.toBe("0");
			const a = createHttpDataService(base, store(), { lock }), profile = (await a.profiles.createProfile({ name: "Container", dailyCaloriesTarget: 2000 }))!; expect(profile.revision).toBe(1);
			await new Promise<void>((resolve,reject) => { const browser = spawn(process.execPath, ["scripts/browser-web-smoke.mjs", base], { stdio: ["ignore", "pipe", "pipe"] }); let text = ""; const timer = setTimeout(() => { browser.kill("SIGTERM"); reject(new Error("Browser timeout")); },60_000); browser.stdout.on("data",chunk => { text += chunk; }); browser.stderr.on("data",chunk => { text += chunk; }); browser.once("error",error => { clearTimeout(timer); reject(error); }); browser.once("exit",code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(text)); }); });
			const start = Date.now(); while (Date.now()-start < 45_000 && (await command("docker", ["inspect", "--format", "{{.State.Health.Status}}", name])).stdout.trim() !== "healthy") await new Promise(resolve => setTimeout(resolve,1000)); expect((await command("docker", ["inspect", "--format", "{{.State.Health.Status}}", name])).stdout.trim()).toBe("healthy");
			await command("docker", ["stop", "--time", "15", name]); expect((await command("docker", ["inspect", "--format", "{{.State.ExitCode}}", name])).stdout.trim()).toBe("0"); await command("docker", ["start", name]); await ready();
			const list = await createHttpDataService(base, store(), { lock }).profiles.listProfiles(); expect(list).toHaveLength(2); expect(list.find(row => row.name === "Container")!.id).toBe(profile.id);
		} finally { await command("docker", ["rm", "-f", name]).catch(() => {}); await database.close(); }
	}, 150_000);
});
