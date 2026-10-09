import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import type { ServerDatabase } from "../../server/database/connection";
import type { ServerBinding, ServerInfo, SnapshotPage, ChangePage } from "../../shared/domain/protocol";
import type { ServerWriteBatch } from "../../shared/domain/server";
import { createUuid } from "../../shared/domain/sync";
import { createSyncHttpClient } from "../../app/utils/sync/http";
import { newDatabase, resetDatabase, testConfig } from "./helpers";
import { createTestDatabase } from "../helpers/sqlite";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createSyncDecisions } from "../../app/utils/sync/decisions";
import { fetchDecisionProof } from "../../app/utils/sync/proof";
import { createFoodAliases } from "../../app/utils/sync/food-alias";
import { createManualSyncRunner } from "../../app/utils/sync/runner";
import { createSyncAddressSettings } from "../../app/utils/sync/address";
import { utcTimestamp } from "../../shared/domain/server-validation";
const technicalTimes = (data: unknown) => JSON.parse(JSON.stringify(data, (key, value) => value !== null && ["createdAt", "updatedAt"].includes(key) ? utcTimestamp(value, key) : value));
import { createHttpDataService, type WebWriteLock } from "../../app/utils/data/http";
const webLock: WebWriteLock = { run: async (_key, action) => action() };
function journalStore() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
import { food as wireFood } from "../helpers/sync-wire";
const profile = (name = "HTTP 🥗") => ({ id: createUuid(), name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: "2026-10-05T12:00:00.000Z", updated_at: null });

describe("built Nitro sync HTTP API", () => {
	let db: ServerDatabase, child: ChildProcess, base: string, binding: ServerBinding, logs = "";
	const headers = { "x-munchling-protocol": "1", "content-type": "application/json" };
	const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...binding, ...extra }).toString();
	const post = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${base}/api/sync/${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
	const batch = (p = profile(), baseRevision = 0): ServerWriteBatch => ({ ...binding, batchId: createUuid(), operations: [{ operationId: createUuid(), entity: "profiles", entityUuid: p.id, baseRevision, operation: "upsert", payload: p }] });
	async function raw(headers: Record<string, string>, body?: Buffer) {
		return new Promise<{ status: number; text: string }>((resolve, reject) => {
			const req = request(`${base}/api/sync/push`, { method: "POST", headers }, (res) => { let text = ""; res.on("data", (value) => { text += String(value); }); res.on("end", () => resolve({ status: res.statusCode!, text })); });
			req.on("error", reject); req.end(body);
		});
	}
	beforeAll(async () => {
		db = newDatabase(); await resetDatabase(db, false);
		const socket = createServer(); await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve)); const address = socket.address(); if (!address || typeof address === "string") throw new Error("Missing HTTP port"); const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve())); base = `http://127.0.0.1:${port}`;
		const config = testConfig(); child = spawn(process.execPath, [".output/server/index.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: {
			...process.env, NITRO_HOST: "127.0.0.1", NITRO_PORT: String(port), NUXT_SERVER_ENABLED: "true", NUXT_MARIA_DB_CONNECTION_LIMIT: "3", NUXT_SYNC_PUBLIC_ORIGIN: base, NUXT_SYNC_ALLOWED_ORIGINS: "capacitor://localhost,https://localhost,http://localhost",
			NUXT_MARIA_DB_HOST: config.host, NUXT_MARIA_DB_PORT: String(config.port), NUXT_MARIA_DB_USER: config.user, NUXT_MARIA_DB_PASSWORD: config.password, NUXT_MARIA_DB_DATABASE: config.database,
		} }); child.stdout?.on("data", (value) => { logs += String(value); }); child.stderr?.on("data", (value) => { logs += String(value); });
		for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error("Backend exited during startup"); try { if ((await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch { /* waiting */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
		throw new Error("Backend startup timed out");
	});
	beforeEach(async () => { await resetDatabase(db); const info: ServerInfo = await (await fetch(`${base}/api/sync/info`)).json(); binding = { serverInstanceId: info.serverInstanceId, serverEpoch: info.serverEpoch }; });
	afterAll(async () => {
		if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 6000); try { await exited; } finally { clearTimeout(timer); } }
		if (db) await db.close();
	});
	it("uses the production client decoder against actual Nitro responses", async () => {
		const client = createSyncHttpClient(base); expect((await client.info()).serverEpoch).toBe(binding.serverEpoch);
		const command = batch(); const receipt = await client.push(command); expect(await client.push(command)).toEqual(receipt);
		const snapshot = await client.startSnapshot(binding); expect(snapshot.aggregates[0]!.data).toEqual(command.operations[0]!.payload);
		expect((await client.changes(binding, "0")).batches[0]!.changes[0]!.aggregate.id).toBe(command.operations[0]!.entityUuid);
		await client.releaseSnapshot(snapshot);
	});
	async function runnerTransport(input: RequestInfo | URL, init?: RequestInit) {
		const target = new URL(String(input));
		if (target.origin !== base) throw new Error("Non-test transport origin");
		if (target.pathname === "/api/sync/info") return fetch(`${base}/api/sync/info`, init);
		if (target.pathname === "/api/sync/push") return fetch(`${base}/api/sync/push`, init);
		if (target.pathname === "/api/sync/changes") return fetch(`${base}/api/sync/changes?${target.searchParams}`, init);
		throw new Error("Unsupported test transport endpoint");
	}
	async function prepareNative(local: Awaited<ReturnType<typeof createTestDatabase>>) {
		const stage = createSnapshotStaging(local.database), state = await stage.state();
		const pages = await fetchDecisionProof(base, binding);
		await stage.begin(state.localEpoch, base, pages[0]!); for (const page of pages.slice(1)) await stage.save(page);
		const decisions = createSyncDecisions(local.database, async () => {}), review = await decisions.initialPreview();
		await decisions.initialCommit(review.token, "combine", await fetchDecisionProof(base, binding));
	}
	it("replays legacy payloads unchanged without clearing new portion metadata, then permits explicit clearing", async () => {
		const client = createSyncHttpClient(base), root = wireFood(); root.data!.portion_size_grams = 125;
		const command = (payload: Record<string, unknown>, baseRevision: number) => ({ ...binding, batchId: createUuid(), operations: [{ operationId: createUuid(), entity: 'foods' as const, entityUuid: root.id, baseRevision, operation: 'upsert' as const, payload }] });
		await client.push(command(root.data!, 0));
		const legacy = { ...root.data!, name_de: 'Legacy edit' }; delete legacy.portion_size_grams;
		const request = command(legacy, 1), before = JSON.stringify(request);
		const receipt = await client.push(request); expect(await client.push(request)).toEqual(receipt); expect(JSON.stringify(request)).toBe(before);
		let current = (await fetchDecisionProof(base, binding)).flatMap(page => page.aggregates).find(row => row.id === root.id)!;
		expect(current.data!.portion_size_grams).toBe(125);
		await client.push(command({ ...current.data!, portion_size_grams: null }, current.version));
		current = (await fetchDecisionProof(base, binding)).flatMap(page => page.aggregates).find(row => row.id === root.id)!;
		expect(current.data!.portion_size_grams).toBeNull();
	});
	it("manually round-trips all six business tables between two phones and editable web across restart", async () => {
		let a = await createTestDatabase(); const b = await createTestDatabase();
		try {
			const p = (await a.service.profiles.createProfile({ name: "Phone household", dailyCaloriesTarget: 2000 }))!;
			const f = (await a.service.foods.createFood({ nameDe: "Phone food", nameEn: "Phone food", portionSizeGrams: 125, ean: "9123456789012", caloriesPer100g: 100, fatPer100g: 2, carbsPer100g: 10, sugarPer100g: 1, fiberPer100g: 2, proteinPer100g: 10, saltPer100g: 0.5 }))!;
			const r = (await a.service.recipes.createRecipe({ nameDe: "Phone recipe", nameEn: "Phone recipe", portionSizeGrams: 300, ingredients: [{ foodId: f.id, amountGrams: 150 }] }))!;
			const m = (await a.service.mealLogs.createMealLog({ loggedAt: "2019-02-03 12:30", recipeId: r.id, profiles: [{ profileId: p.id, portionGrams: 33.125 }] }))!;
			await createSyncAddressSettings(a.database).remember(base); await prepareNative(a);
			const identities = (await a.service.backups!.exportBackup());
			expect((await createManualSyncRunner(a.database).sync(true)).uploaded).toBe(4);
			await prepareNative(b); expect(technicalTimes((await b.service.backups!.exportBackup()).data)).toEqual(technicalTimes((await a.service.backups!.exportBackup()).data));
			const web = createHttpDataService(base, journalStore(), { lock: webLock });
			const wp = (await web.profiles.listProfiles())[0]!, wf = (await web.foods.listFoods())[0]!, wr = (await web.recipes.listRecipes())[0]!, wm = (await web.mealLogs.listMealLogs())[0]!;
			await web.profiles.updateProfile(wp.id, { name: "Edited online" }, wp.revision);
			expect(wf.portionSizeGrams).toBe(125); expect(wr.portionSizeGrams).toBe(300);
			await web.foods.updateFood(wf.id, { proteinPer100g: 20, portionSizeGrams: 150 }, wf.revision);
			await web.recipes.updateRecipe(wr.id, { nameDe: "Web recipe", portionSizeGrams: 250, ingredients: [{ foodId: wf.id, amountGrams: 200 }] }, wr.revision);
			await web.mealLogs.updateMealLog(wm.id, { recipeId: wr.id, loggedAt: "2019-02-03 12:30", profiles: [{ profileId: wp.id, portionGrams: 88.125 }] }, wm.revision);
			const newProfile = (await web.profiles.createProfile({ name: "Created online", dailyCaloriesTarget: 2100 }))!;
			const newFood = (await web.foods.createFood({ nameDe: "New online food", nameEn: "New online food", caloriesPer100g: 200, fatPer100g: 1, carbsPer100g: 20, sugarPer100g: 1, fiberPer100g: 2, proteinPer100g: 5, saltPer100g: 0.1 }))!;
			const newRecipe = (await web.recipes.createRecipe({ nameDe: "New online recipe", nameEn: "New online recipe", ingredients: [{ foodId: newFood.id, amountGrams: 75 }] }))!;
			await web.mealLogs.createMealLog({ recipeId: newRecipe.id, loggedAt: "2026-10-06T13:14:15+02:00", profiles: [{ profileId: newProfile.id, portionGrams: 40 }] });
			const bytes = a.exportBytes(); a.close(); a = await createTestDatabase({ bytes });
			expect(await createSyncAddressSettings(a.database).read()).toBe(base);
			expect((await createManualSyncRunner(a.database).sync(true)).uploaded).toBe(0);
			await createManualSyncRunner(b.database).sync(true);
			expect((await a.service.profiles.getProfileById(p.id))!.name).toBe("Edited online");
			expect((await a.service.foods.getFoodById(f.id))!.proteinPer100g).toBe(20);
			expect((await a.service.foods.getFoodById(f.id))!.portionSizeGrams).toBe(150);
			expect((await a.service.recipes.getRecipeById(r.id))!.portionSizeGrams).toBe(250);
			expect((await a.service.recipes.listRecipeIngredients(r.id))[0]!.amountGrams).toBe(200);
			expect((await a.service.mealLogs.getMealLogById(m.id))!.loggedAt).toBe("2019-02-03 12:30");
			expect((await a.service.mealLogs.getMealLogById(m.id))!.totalWeightGrams).toBe(88.13);
			expect(await a.service.profiles.listProfiles()).toHaveLength(2);
			expect(await a.service.foods.listFoods()).toHaveLength(2); expect(await a.service.recipes.listRecipes()).toHaveLength(2); expect(await a.service.mealLogs.listMealLogs()).toHaveLength(2);
			expect((await a.service.mealLogs.listMealLogs()).some(meal => meal.loggedAt === "2026-10-06T13:14:15+02:00")).toBe(true);
			expect(technicalTimes((await a.service.backups!.exportBackup()).data)).toEqual(technicalTimes((await b.service.backups!.exportBackup()).data));
			if (identities.version !== 1) { const next = await a.service.backups!.exportBackup(); if (next.version === 1) throw new Error("identity backup expected"); expect(next.identities.filter(row => ["profiles", "foods", "recipes", "meal_logs"].includes(row.entity))).toEqual(expect.arrayContaining(identities.identities.filter(row => ["profiles", "foods", "recipes", "meal_logs"].includes(row.entity)))); }
			const before = (await createSyncHttpClient(base).info()).cursor; await createManualSyncRunner(a.database).sync(true); await createManualSyncRunner(b.database).sync(true);
			expect((await createSyncHttpClient(base).info()).cursor).toBe(before); expect(await createSyncQueue(a.database).list()).toEqual([]);
		} finally { a.close(); b.close(); }
	});
	it("settles a real committed/lost receipt after restart without duplicating or overwriting a newer phone draft", async () => {
		let local = await createTestDatabase();
		try {
			const p = (await local.service.profiles.createProfile({ name: "Original", dailyCaloriesTarget: 2000 }))!; await prepareNative(local);
			const bodies: string[] = []; let lose = true;
			const transport: typeof fetch = async (input, init) => {
				const response = await runnerTransport(input, init);
				if (String(input).endsWith("/push")) { bodies.push(String(init!.body)); if (lose && response.ok) { lose = false; await response.text(); throw new TypeError("reply lost after commit"); } }
				return response;
			};
			await expect(createManualSyncRunner(local.database, { fetch: transport }).sync(true)).rejects.toThrow("network");
			await local.service.profiles.updateProfile(p.id, { name: "New offline draft" }); const bytes = local.exportBytes(); local.close(); local = await createTestDatabase({ bytes });
			await createManualSyncRunner(local.database, { fetch: transport }).sync(true);
			expect(bodies[0]).toBe(bodies[1]); expect(JSON.parse(bodies[2]!).operations[0].baseRevision).toBe(1);
			const web = createHttpDataService(base, journalStore(), { lock: webLock }); const profiles = await web.profiles.listProfiles();
			expect(profiles).toHaveLength(1); expect(profiles[0]!.name).toBe("New offline draft"); expect((await createManualSyncRunner(local.database).status()).uncertain).toBe(false);
		} finally { local.close(); }
	});
	it("keeps captured bases on a real late web race, records the conflict and releases definitive uncertainty", async () => {
		const local = await createTestDatabase();
		try {
			const p = (await local.service.profiles.createProfile({ name: "Initial", dailyCaloriesTarget: 2000 }))!; await prepareNative(local); await createManualSyncRunner(local.database).sync(true);
			await local.service.profiles.updateProfile(p.id, { name: "Offline draft" }); const old = await createSyncQueue(local.database).list(); let raced = false;
			const transport: typeof fetch = async (input, init) => {
				if (String(input).endsWith("/push") && !raced) { raced = true; const web = createHttpDataService(base, journalStore(), { lock: webLock }), wp = (await web.profiles.listProfiles())[0]!; await web.profiles.updateProfile(wp.id, { name: "Web race" }, wp.revision); }
				return runnerTransport(input, init);
			};
			await expect(createManualSyncRunner(local.database, { fetch: transport }).sync(true)).rejects.toThrow("versionConflict");
			expect(await createSyncQueue(local.database).list()).toEqual(old); const status = await createManualSyncRunner(local.database).status(); expect(status.uncertain).toBe(false); expect(status.blocked).toBe(1);
			expect((await local.service.profiles.getProfileById(p.id))!.name).toBe("Offline draft");
		} finally { local.close(); }
	});
	it("stages and atomically applies real HTTP replies across independent SQLite clients and restart", async () => {
		const a = await createTestDatabase(), b = await createTestDatabase(); let reopened: typeof a | undefined;
		try {
			const client = createSyncHttpClient(base), p = profile(); await client.push(batch(p)); const first = await client.startSnapshot(binding);
			for (const local of [a, b]) {
				const store = createSnapshotStaging(local.database), epoch = (await store.state()).localEpoch;
				await store.begin(epoch, base, first);
				for (let index = 1; index < first.pageCount; index++) await store.save(await client.snapshotPage(first, index));
				expect((await createRemoteReceiver(local.database).adoptSnapshot(epoch)).status).toBe("applied");
			}
			await client.releaseSnapshot(first); const aId = (await a.service.profiles.listProfiles())[0]!.id;
			await a.service.profiles.updateProfile(aId, { name: "Offline edit" }); const pending = await createSyncQueue(a.database).list(); await client.push(batch({ ...p, name: "Server edit" }, 1));
			const changes = await client.changes(binding, first.cursor);
			for (const local of [a, b]) {
				const context = { ...binding, localEpoch: (await createSnapshotStaging(local.database).state()).localEpoch, url: base, cursor: first.cursor };
				expect((await createRemoteReceiver(local.database).applyPage(context, changes))[0]!.status).toBe(local === a ? "blocked" : "applied");
				expect(await createRemoteReceiver(local.database).applyPage(context, changes)).toEqual([]);
			}
			expect((await b.service.profiles.listProfiles())[0]!.name).toBe("Server edit"); expect(await createSyncQueue(b.database).list()).toEqual([]);
			reopened = await createTestDatabase({ bytes: a.exportBytes() }); expect((await reopened.service.profiles.listProfiles())[0]!.name).toBe("Offline edit"); expect(await createSyncQueue(reopened.database).list()).toEqual(pending); expect(await createRemoteReceiver(reopened.database).conflicts()).toHaveLength(1);
		} finally { reopened?.close(); a.close(); b.close(); }
	});
	it("rechecks manual decisions against real server cuts and preserves optimistic concurrency after choosing local", async () => {
		const local = await createTestDatabase();
		try {
			const client = createSyncHttpClient(base), p = profile(); await client.push(batch(p)); const first = await client.startSnapshot(binding), store = createSnapshotStaging(local.database), epoch = (await store.state()).localEpoch;
			await store.begin(epoch, base, first); await client.releaseSnapshot(first);
			const decisions = createSyncDecisions(local.database, async () => {}), initial = await decisions.initialPreview(); await decisions.initialCommit(initial.token, "combine", await fetchDecisionProof(base, binding));
			await local.service.profiles.updateProfile((await local.service.profiles.listProfiles())[0]!.id, { name: "Offline winner" }); const before = await createSyncQueue(local.database).list();
			await client.push(batch({ ...p, name: "Server v2" }, 1)); await createRemoteReceiver(local.database).applyPage({ ...binding, localEpoch: epoch, url: base, cursor: first.cursor }, await client.changes(binding, first.cursor));
			const preview = await decisions.conflictPreview(await fetchDecisionProof(base, binding));
			await client.push(batch({ ...p, name: "Server v3" }, 2)); await expect(decisions.resolve(preview.token, { [p.id]: "local" }, await fetchDecisionProof(base, binding))).rejects.toThrow("previewChanged"); expect(await createSyncQueue(local.database).list()).toEqual(before);
			const latest = await decisions.conflictPreview(await fetchDecisionProof(base, binding)); await decisions.resolve(latest.token, { [p.id]: "local" }, await fetchDecisionProof(base, binding));
			const queued = await createSyncQueue(local.database).list(); expect(queued[0]!.baseRevision).toBe(3); expect(queued[0]!.payload.name).toBe("Offline winner");
			await client.push(batch({ ...p, name: "Another editor v4" }, 3));
			const attempt: ServerWriteBatch = { ...binding, batchId: queued[0]!.batchId, operations: queued.map(op => ({ operationId: op.operationId, entity: op.entity, entityUuid: op.entityUuid, baseRevision: op.baseRevision, operation: op.operation, payload: op.payload })) };
			await expect(client.push(attempt)).rejects.toMatchObject({ code: "versionConflict" }); expect(await createSyncQueue(local.database).list()).toEqual(queued);
			expect((await fetchDecisionProof(base, binding))[0]!.aggregates[0]!.data!.name).toBe("Another editor v4");
		} finally { local.close(); }
	});
	it("serves a genuinely online, editable website without browser SQLite", async () => {
		const output = await new Promise<string>((resolve, reject) => {
			const browser = spawn(process.execPath, ["scripts/browser-web-smoke.mjs", base], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] }); let text = "";
			const timer = setTimeout(() => { browser.kill("SIGTERM"); reject(new Error("Browser web smoke timeout")); }, 60_000);
			browser.stdout.on("data", data => { text += data; }); browser.stderr.on("data", data => { text += data; }); browser.once("error", error => { clearTimeout(timer); reject(error); }); browser.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(text)); else resolve(text); });
		});
		expect(output).toContain("PASS: versioned website edit survives reload"); expect((await createSyncHttpClient(base).webState(binding)).snapshot.aggregates[0]!.data!.name).toBe("Browser updated");
	}, 75_000);
	it("edits the shared household through the online adapter with stable view IDs and optimistic forms", async () => {
		const a = createHttpDataService(base, journalStore(), { lock: webLock }), b = createHttpDataService(base, journalStore(), { lock: webLock });
		const p = (await a.profiles.createProfile({ name: "Web", dailyCaloriesTarget: 2000 }))!, q = (await a.profiles.createProfile({ name: "Second", dailyCaloriesTarget: 1000 }))!;
		const food = (await a.foods.createFood({ nameDe: "Food", nameEn: "Food", ean: "123", caloriesPer100g: 100, fatPer100g: 0, carbsPer100g: 10, proteinPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, saltPer100g: 0 }))!;
		const old = (await b.foods.listFoods())[0]!; await a.foods.updateFood(food.id, { brand: "New" }, food.revision); await expect(b.foods.updateFood(old.id, { brand: "Stale" }, old.revision)).rejects.toThrow("versionConflict"); expect(b.hasPendingWrite()).toBe(false); expect((await b.foods.listFoods())[0]).toMatchObject({ id: food.id, brand: "New", revision: 2 });
		await expect(b.foods.updateFood(old.id, { brand: "Still stale" }, old.revision)).rejects.toThrow("versionConflict");
		const recipe = (await a.recipes.createRecipe({ nameDe: "R", nameEn: "R", ingredients: [{ foodId: food.id, amountGrams: 50 }] }))!, nested = (await a.recipes.createRecipe({ nameDe: "Nested", nameEn: "Nested", ingredients: [{ subRecipeId: recipe.id, amountGrams: 75 }] }))!;
		expect((await a.recipes.calculateRecipeNutrition(nested.id)).per100g.calories).toBe(100);
		const loggedAt = "2019-06-07 12:34:56", meal = (await a.mealLogs.createMealLog({ loggedAt, recipeId: nested.id, profiles: [{ profileId: p.id, portionGrams: 33.3 }, { profileId: q.id, portionGrams: 66.7 }] }))!;
		expect(meal).toMatchObject({ loggedAt, totalWeightGrams: 100 }); expect(meal.profiles.map(row => row.portionGrams).sort()).toEqual([33.3, 66.7]); expect(await a.mealLogs.listMealLogs({ profileId: p.id, date: "2019-06-07" })).toHaveLength(1);
		await expect(a.foods.deleteFood(food.id, 2)).rejects.toThrow("dependencyConflict");
		await a.mealLogs.deleteMealLog(meal.id, meal.revision); await a.recipes.deleteRecipe(nested.id, nested.revision); await a.recipes.deleteRecipe(recipe.id, recipe.revision); await a.foods.deleteFood(food.id, 2); await a.profiles.deleteProfile(q.id, q.revision);
		expect((await createHttpDataService(base, journalStore(), { lock: webLock }).profiles.listProfiles())[0]!.id).toBe(p.id); expect(a.backups).toBeUndefined();
	});
	it("retains a lost web receipt across restart and replays the identical journal, never a fresh create", async () => {
		const store = journalStore(); let lose = true, writes = 0;
		const fetcher: typeof fetch = async (input, init) => { const target = new URL(String(input)); if (target.origin !== base || !target.pathname.startsWith("/api/sync/") || target.username || target.password) throw new Error("Unexpected test URL"); const response = await fetch(target, init); if (String(input).endsWith("/push")) { writes++; if (lose && response.ok) { lose = false; await response.text(); throw new Error("lost receipt"); } } return response; };
		const a = createHttpDataService(base, store, { lock: webLock, fetch: fetcher }); await expect(a.profiles.createProfile({ name: "Once", dailyCaloriesTarget: 1000 })).rejects.toThrow("network"); expect(a.hasPendingWrite()).toBe(true);
		await expect(a.profiles.createProfile({ name: "Duplicate", dailyCaloriesTarget: 1000 })).rejects.toThrow("unconfirmedUpload");
		const restarted = createHttpDataService(base, store, { lock: webLock, fetch: fetcher }); await restarted.retryPendingWrite(); expect(restarted.hasPendingWrite()).toBe(false); expect(await restarted.profiles.listProfiles()).toHaveLength(1); expect(writes).toBe(2);
	});
	it("maps a local EAN import to an actual server UUID and uploads only remapped aggregates", async () => {
		const local = await createTestDatabase();
		try {
			const client = createSyncHttpClient(base), target = wireFood("C"); await client.push({ ...binding, batchId: createUuid(), operations: [{ operationId: createUuid(), entity: "foods", entityUuid: target.id, baseRevision: 0, operation: "upsert", payload: target.data! }] });
			const source = await local.service.foods.createFood({ nameDe: "Local", nameEn: "Local", ean: "C", caloriesPer100g: 200, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 });
			const sourceId = (await local.database.query<{ uuid: string }>("SELECT uuid FROM foods WHERE id=?;", [source!.id]))[0]!.uuid;
			await local.service.recipes.createRecipe({ nameDe: "Recipe", nameEn: "Recipe", ingredients: [{ foodId: source!.id, amountGrams: 12.5 }] });
			const store = createSnapshotStaging(local.database), epoch = (await store.state()).localEpoch, first = await client.startSnapshot(binding); await store.begin(epoch, base, first); await client.releaseSnapshot(first); expect((await createRemoteReceiver(local.database).adoptSnapshot(epoch)).status).toBe("blocked");
			const aliases = createFoodAliases(local.database, async () => {}), review = (await aliases.preview(await fetchDecisionProof(base, binding)))[0]!; await aliases.commit(review.token, sourceId, target.id, await fetchDecisionProof(base, binding), true);
			const queue = createSyncQueue(local.database), operations = await queue.claimNextBatch(); expect(operations).toHaveLength(1); expect(operations[0]!.entity).toBe("recipes"); expect(JSON.stringify(operations[0]!.payload)).not.toContain(sourceId);
			const receipt = await client.push({ ...binding, batchId: operations[0]!.batchId, operations: operations.map(op => ({ operationId: op.operationId, entity: op.entity, entityUuid: op.entityUuid, baseRevision: op.baseRevision, operation: op.operation, payload: op.payload })) }); await queue.acknowledgeBatch(receipt.batchId, receipt.operations.map(op => ({ operationId: op.operationId, serverRevision: op.serverRevision })));
			const proof = await fetchDecisionProof(base, binding); expect(proof.flatMap(page => page.identities).some(row => row.uuid === sourceId)).toBe(false);
			const recipe = proof.flatMap(page => page.aggregates).find(root => root.entity === "recipes")!; expect((recipe.data!.ingredients as Record<string, unknown>[])[0]!.food_id).toBe(target.id); expect(await queue.list()).toEqual([]);
		} finally { local.close(); }
	});
	it("negotiates info, pushes/replays and pulls exact confirmed data without duplicate operations", async () => {
		const infoResponse = await fetch(`${base}/api/sync/info`); expect(infoResponse.status).toBe(200); expect(infoResponse.headers.get("cache-control")).toBe("no-store"); expect(await infoResponse.json()).toMatchObject({ protocolVersion: 1, schemaVersion: 3, capabilities: { authentication: "none" } });
		const command = batch(); const first = await post("push", command); expect(first.status).toBe(200); const receipt = await first.json(); expect(await (await post("push", command)).json()).toEqual(receipt);
		const delta: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`, { headers })).json(); expect(delta).toMatchObject({ cursor: "1", hasMore: false }); expect(delta.batches[0]!.changes[0]!.aggregate.data).toEqual(command.operations[0]!.payload);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_operations"))).toEqual([{ n: 1 }]);
	});
	it("lets two independent clients download the same cut, edit, conflict and explicitly re-submit", async () => {
		const p = profile(); await post("push", batch(p));
		const a: SnapshotPage = await (await post("snapshots", binding)).json(); const b: SnapshotPage = await (await post("snapshots", binding)).json(); expect(a.aggregates).toEqual(b.aggregates);
		const editA = batch({ ...p, name: "Client A" }, 1); expect((await post("push", editA)).status).toBe(200);
		const editB = batch({ ...p, name: "Client B" }, 1); const conflict = await post("push", editB); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: { code: "versionConflict", resync: false, retryable: false, current: [{ id: p.id, version: 2, data: { name: "Client A" } }] } });
		const resolved = batch({ ...p, name: "Client B" }, 2); expect((await post("push", resolved)).status).toBe(200);
		const read: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: a.cursor })}`, { headers })).json(); expect(read.batches).toHaveLength(2); expect(read.batches[1]!.changes[0]!.aggregate.data!.name).toBe("Client B");
	});
	it("resumes immutable paged snapshots and releases their storage idempotently", async () => {
		const a = batch(profile("a".repeat(70_000))), b = batch(profile("b".repeat(70_000))); await post("push", a); await post("push", b);
		const first: SnapshotPage = await (await post("snapshots", { ...binding, targetBytes: 65_536 })).json(); expect(first.nextPage).not.toBeNull();
		const edit = batch({ ...a.operations[0]!.payload, name: "Changed" } as ReturnType<typeof profile>, 1); await post("push", edit);
		const second: SnapshotPage = await (await fetch(`${base}/api/sync/snapshots/${first.snapshotId}?${query({ page: "1" })}`, { headers })).json(); expect(second.cursor).toBe(first.cursor); expect(second.aggregates[0]!.data!.name).not.toBe("Changed");
		const url = `${base}/api/sync/snapshots/${first.snapshotId}?${query()}`; expect((await fetch(url, { method: "DELETE", headers })).status).toBe(200); expect((await fetch(url, { method: "DELETE", headers })).status).toBe(200);
		expect((await fetch(`${url}&page=0`, { headers })).status).toBe(410);
	});
	it("serializes simultaneous edits from separate clients without silent overwrites", async () => {
		const p = profile(); await post("push", batch(p));
		const responses = await Promise.all([post("push", batch({ ...p, name: "A" }, 1)), post("push", batch({ ...p, name: "B" }, 1))]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const changes: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: "1" })}`, { headers })).json(); expect(changes.batches).toHaveLength(1); expect(changes.batches[0]!.changes[0]!.aggregate.version).toBe(2);
	});
	it("returns explicit dependency/version conflicts and tombstones for ordinary deletions", async () => {
		const p = profile(); await post("push", batch(p));
		const preview = await fetch(`${base}/api/sync/deletion-preview?${query({ entity: "profiles", id: p.id })}`, { headers }); expect(await preview.json()).toMatchObject({ root: { id: p.id, version: 1 }, dependents: [] });
		const del = batch(p, 1); del.operations[0]!.operation = "delete"; del.operations[0]!.payload = { id: p.id };
		expect((await post("push", del)).status).toBe(200); const stale = await post("push", batch({ ...p, name: "Resurrect?" }, 1)); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { current: [{ version: 2, data: null }] } });
	});
	it("demands protocol negotiation and controlled resync for unknown cursors/epochs", async () => {
		const mismatch = await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`); expect(mismatch.status).toBe(426); expect(await mismatch.json()).toMatchObject({ error: { code: "protocolMismatch" } });
		const cursor = await fetch(`${base}/api/sync/changes?${query({ cursor: "999" })}`, { headers }); expect(cursor.status).toBe(409); expect(await cursor.json()).toMatchObject({ error: { code: "cursorInvalid", resync: true } });
		const changed = await post("snapshots", { ...binding, serverEpoch: createUuid() }); expect(changed.status).toBe(409); expect(await changed.json()).toMatchObject({ error: { code: "serverChanged", resync: true } });
	});
	it("allows explicitly trusted native/browser origins and rejects hostile/null origins and rebinding hosts", async () => {
		for (const origin of [base, "capacitor://localhost", "https://localhost", "http://localhost"]) { const response = await fetch(`${base}/api/sync/info`, { headers: { origin } }); expect(response.status).toBe(200); expect(response.headers.get("access-control-allow-origin")).toBe(origin); expect(response.headers.get("access-control-allow-credentials")).toBeNull(); }
		for (const origin of ["https://evil.invalid", "https://localhost.evil.invalid", "null"]) expect((await post("push", batch(), { origin })).status).toBe(403);
		const denied = await raw({ ...headers, host: "evil.invalid" }, Buffer.from(JSON.stringify(batch()))); expect(denied.status).toBe(403);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_batches"))).toEqual([{ n: 0 }]);
	});
	it("serves restricted native preflight but rejects extra headers/methods", async () => {
		const h = { origin: "https://localhost", "access-control-request-method": "POST", "access-control-request-headers": "Content-Type, X-Munchling-Protocol" };
		const info = await fetch(`${base}/api/sync/info`, { method: "OPTIONS", headers: { ...h, "access-control-request-method": "GET", "access-control-request-headers": "X-Munchling-Protocol" } }); expect(info.status).toBe(204); expect(info.headers.get("access-control-allow-origin")).toBe(h.origin);
		const good = await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: h }); expect(good.status).toBe(204); expect(good.headers.get("access-control-allow-origin")).toBe(h.origin);
		expect((await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: { ...h, "access-control-request-headers": "authorization" } })).status).toBe(403);
		expect((await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: { ...h, "access-control-request-method": "PUT" } })).status).toBe(403);
	});
	it("rejects non-JSON, malformed UTF-8/JSON, compressed and oversized bodies before writing", async () => {
		expect((await post("push", batch(), { "content-type": "text/plain" })).status).toBe(415);
		expect((await post("push", batch(), { "content-encoding": "gzip" })).status).toBe(415);
		expect((await raw(headers, Buffer.from("{"))).status).toBe(400); expect((await raw(headers, Buffer.from([0xc3, 0x28]))).status).toBe(400);
		expect((await raw({ ...headers, "content-length": String(26 * 1024 * 1024) })).status).toBe(413);
		expect((await raw(headers, Buffer.alloc(25 * 1024 * 1024 + 1, 32))).status).toBe(413);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_batches"))).toEqual([{ n: 0 }]);
	});
	it("sanitizes driver/validation failures and logs no names, payloads or credentials", async () => {
		const command = batch(profile("PRIVATE-PROFILE-NAME")); delete command.operations[0]!.payload.daily_calories_target;
		const invalid = await post("push", command); expect(invalid.status).toBe(422); const content = await invalid.text(); expect(content).not.toContain("PRIVATE-PROFILE-NAME");
		await db.withConnection((sql) => sql.write("DROP TABLE change_log")); const response = await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`, { headers }); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: "DB_READ_FAILED", retryable: true } });
		expect(logs).not.toContain("PRIVATE-PROFILE-NAME"); expect(logs).not.toContain(testConfig().password); expect(logs).not.toContain("SELECT ");
	});
});
