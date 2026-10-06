import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { binding, food, page, profile, snapshot, url } from "../helpers/sync-wire";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createFoodAliases } from "../../app/utils/sync/food-alias";
import { createUuid } from "../../shared/domain/sync";
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function setup(existingTarget = false) {
	const db = await createTestDatabase(); opened.push(db); const target = food("C"), store = createSnapshotStaging(db.database), epoch = (await store.state()).localEpoch;
	await store.begin(epoch, url, snapshot(existingTarget ? [target] : [])); await createRemoteReceiver(db.database).adoptSnapshot(epoch);
	if (existingTarget) await db.database.transaction(async sql => { await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;"); await sql.run("UPDATE foods SET ean=NULL WHERE uuid=?;", [target.id]); await sql.run("UPDATE sync_state SET tracking_enabled=1 WHERE id=1;"); });
	const source = await db.service.foods.createFood({ nameDe: "Local", nameEn: "Local", ean: "C", caloriesPer100g: 200, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 });
	const sourceId = (await db.database.query<{ uuid: string }>("SELECT uuid FROM foods WHERE id=?;", [source!.id]))[0]!.uuid;
	return { db, source: source!, sourceId, target, wire: snapshot([target], "1"), store, epoch };
}
afterEach(() => opened.splice(0).forEach(db => db.close()));
describe("explicit local food import alias", () => {
	it("atomically remaps ingredients and historical meals without cascades or child ID changes", async () => {
		const { db, source, sourceId, target, wire, store } = await setup();
		await db.service.profiles.createProfile({ name: "P", dailyCaloriesTarget: 2000 }); const p = (await db.service.profiles.listProfiles())[0]!;
		await db.service.recipes.createRecipe({ nameDe: "R", nameEn: "R", ingredients: [{ foodId: source.id, amountGrams: 50 }] });
		await db.service.mealLogs.createMealLog({ foodId: source.id, loggedAt: "2024-05-10 18:30:00", profiles: [{ profileId: p.id, portionGrams: 37.5 }] });
		const children = await db.database.query("SELECT id,uuid,recipe_id,amount_grams FROM recipe_ingredients;"), portions = await db.database.query("SELECT * FROM meal_log_profiles;"), save = vi.fn(async () => {}), aliases = createFoodAliases(db.database, save), review = (await aliases.preview([wire]))[0]!;
		expect(review).toMatchObject({ ingredientCount: 1, mealCount: 1 }); await aliases.commit(review.token, sourceId, target.id, [wire], true);
		expect(await db.database.query("SELECT id,uuid,recipe_id,amount_grams FROM recipe_ingredients;")).toEqual(children); expect(await db.database.query("SELECT * FROM meal_log_profiles;")).toEqual(portions);
		const targetId = (await db.database.query<{ id: number }>("SELECT id FROM foods WHERE uuid=?;", [target.id]))[0]!.id;
		expect(await db.database.query("SELECT food_id FROM recipe_ingredients;")).toEqual([{ food_id: targetId }]); expect(await db.database.query("SELECT food_id,logged_at,total_weight_grams FROM meal_logs;")).toEqual([{ food_id: targetId, logged_at: "2024-05-10 18:30:00", total_weight_grams: 37.5 }]);
		expect(await db.database.query("SELECT uuid FROM foods WHERE uuid=?;", [sourceId])).toEqual([]); expect(save).toHaveBeenCalledOnce(); expect((await store.state()).enabled).toBe(false); expect((await store.state()).cursor).toBe("0");
		const queue = await createSyncQueue(db.database).list(); expect(queue.some(row => row.entityUuid === sourceId || JSON.stringify(row.payload).includes(sourceId))).toBe(false); expect(queue.filter(row => row.entity === "recipes" || row.entity === "meal_logs").every(row => row.baseRevision === 0)).toBe(true);
		const reopened = await createTestDatabase({ bytes: db.exportBytes() }); opened.push(reopened); expect(await createSyncQueue(reopened.database).list()).toEqual(queue); expect(await reopened.database.query("SELECT id,uuid,recipe_id,amount_grams FROM recipe_ingredients;")).toEqual(children);
	});
	it("preserves an already mapped target's numeric ID", async () => {
		const { db, target, sourceId, wire } = await setup(true), id = (await db.database.query<{ id: number }>("SELECT id FROM foods WHERE uuid=?;", [target.id]))[0]!.id, aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		await aliases.commit(review.token, sourceId, target.id, [wire], true); expect(await db.database.query("SELECT id FROM foods WHERE uuid=?;", [target.id])).toEqual([{ id }]);
	});
	it("requires confirmation and unchanged local/server previews", async () => {
		const { db, source, sourceId, target, wire } = await setup(), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		await expect(aliases.commit(review.token, sourceId, target.id, [wire])).rejects.toThrow("confirmFoodAlias");
		await expect(aliases.commit(review.token, sourceId, target.id, [snapshot([food("C", target.id, 2)], "2")], true)).rejects.toThrow("previewChanged");
		await db.service.foods.updateFood(source.id, { caloriesPer100g: 250 }); await expect(aliases.commit(review.token, sourceId, target.id, [wire], true)).rejects.toThrow("previewChanged");
	});
	it("does not merge previously registered sources or an edited target", async () => {
		const { db, sourceId, target, wire } = await setup(), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		const registered = snapshot([target, food("D", sourceId)], "2"); expect(await aliases.preview([registered])).toEqual([]); await expect(aliases.commit(review.token, sourceId, target.id, [registered], true)).rejects.toThrow("aliasSourceRegistered");
		await db.database.run("UPDATE sync_records SET server_revision=1 WHERE uuid=?;", [sourceId]); expect(await aliases.preview([wire])).toEqual([]);
	});
	it("refuses a target with pending local edits", async () => {
		const { db, target, sourceId, wire } = await setup(true), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		const id = (await db.database.query<{ id: number }>("SELECT id FROM foods WHERE uuid=?;", [target.id]))[0]!.id; await db.service.foods.updateFood(id, { brand: "Draft" }); expect(await aliases.preview([wire])).toEqual([]); await expect(aliases.commit(review.token, sourceId, target.id, [wire], true)).rejects.toThrow("aliasTargetEdited");
	});
	it("preserves earlier bases even when the fresh server proof has newer companion revisions", async () => {
		const { db, source, sourceId, target, epoch } = await setup(), other = food("D"), serverRecipe = { entity: "recipes" as const, id: createUuid(), version: 1, deletedAt: null, data: null as Record<string, unknown> | null };
		serverRecipe.data = { id: serverRecipe.id, name_de: "R", name_en: "R", description: null, is_sub_recipe: 0, created_at: "2026-10-05T12:00:00.000Z", updated_at: null, ingredients: [] };
		await createRemoteReceiver(db.database).applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([serverRecipe])); const id = (await db.service.recipes.listRecipes())[0]!.id;
		await db.service.recipes.updateRecipe(id, { ingredients: [{ foodId: source.id, amountGrams: 25 }] });
		const newer = { ...serverRecipe, version: 2, data: { ...serverRecipe.data, name_de: "Server change" } }, wire = snapshot([target, other, newer], "3"), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		await aliases.commit(review.token, sourceId, target.id, [wire], true); expect((await createSyncQueue(db.database).list()).find(row => row.entity === "recipes")!.baseRevision).toBe(1);
	});
	it("rejects unknown upload outcomes, epoch switches and wrong EANs without changing data", async () => {
		const { db, sourceId, target, wire } = await setup(), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!;
		await expect(aliases.commit(review.token, sourceId, target.id, [{ ...wire, serverEpoch: createUuid() }], true)).rejects.toThrow("serverChanged");
		await expect(aliases.commit(review.token, sourceId, target.id, [snapshot([food("X", target.id)], "1")], true)).rejects.toThrow("aliasEanMismatch");
		const queue = createSyncQueue(db.database), claimed = await queue.claimNextBatch(); await expect(aliases.preview([wire])).rejects.toThrow("unconfirmedUpload"); expect(await queue.claimNextBatch()).toEqual(claimed);
	});
	it("rolls back remapping and all queue changes if safety storage or late SQL fails", async () => {
		const { db, source, sourceId, target, wire } = await setup(); await db.service.recipes.createRecipe({ nameDe: "R", nameEn: "R", ingredients: [{ foodId: source.id, amountGrams: 50 }] });
		const fail = createFoodAliases(db.database, async () => { throw new Error("disk full"); }), review = (await fail.preview([wire]))[0]!, before = await createSyncQueue(db.database).list(); await expect(fail.commit(review.token, sourceId, target.id, [wire], true)).rejects.toThrow("disk full");
		await db.database.execute("CREATE TRIGGER fail_alias BEFORE DELETE ON foods BEGIN SELECT RAISE(ABORT,'injected'); END;"); const aliases = createFoodAliases(db.database, vi.fn(async () => {})), next = (await aliases.preview([wire]))[0]!;
		await expect(aliases.commit(next.token, sourceId, target.id, [wire], true)).rejects.toThrow("injected"); expect(await createSyncQueue(db.database).list()).toEqual(before); expect(await db.database.query("SELECT food_id FROM recipe_ingredients;")).toEqual([{ food_id: source.id }]); expect(await db.database.query("SELECT uuid FROM foods;")).toEqual([{ uuid: sourceId }]);
	});
	it("rebuilds whole pending batches, including historical references and unchanged companions, without rebasing", async () => {
		const { db, source, sourceId, target, wire } = await setup();
		await db.service.profiles.createProfile({ name: "Companion", dailyCaloriesTarget: 2000 }); const p = (await db.service.profiles.listProfiles())[0]!;
		await db.service.recipes.createRecipe({ nameDe: "R", nameEn: "R", ingredients: [{ foodId: source.id, amountGrams: 50 }] }); const r = (await db.service.recipes.listRecipes())[0]!;
		await db.database.transaction(async sql => { await sql.run("UPDATE profiles SET name='New companion' WHERE id=?;", [p.id]); await sql.run("UPDATE recipes SET name_de='New R' WHERE id=?;", [r.id]); });
		await db.service.recipes.updateRecipe(r.id, { ingredients: [] });
		const before = await createSyncQueue(db.database).list(), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([wire]))[0]!; expect(review.ingredientCount).toBe(0); expect(review.companions).toHaveLength(2);
		await aliases.commit(review.token, sourceId, target.id, [wire], true); const queue = await createSyncQueue(db.database).list(); expect(queue).toHaveLength(2); expect(new Set(queue.map(row => row.batchId)).size).toBe(1); expect(queue.every(row => row.baseRevision === 0 && !before.some(old => old.operationId === row.operationId))).toBe(true); expect(queue.find(row => row.entity === "recipes")!.payload.ingredients).toEqual([]); expect(queue.find(row => row.entity === "profiles")!.payload.name).toBe("New companion");
	});
	it("leaves received groups blocked for ordinary decisions instead of skipping their other roots", async () => {
		const { db, sourceId, target, epoch } = await setup(), receiver = createRemoteReceiver(db.database), other = profile();
		await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([target, other])); const proof = snapshot([target, other], "2"), aliases = createFoodAliases(db.database, vi.fn(async () => {})), review = (await aliases.preview([proof]))[0]!;
		await aliases.commit(review.token, sourceId, target.id, [proof], true); expect(await db.service.profiles.listProfiles()).toEqual([]); expect(await db.database.query("SELECT id FROM sync_inbox WHERE status='blocked';")).toHaveLength(1); expect((await createSnapshotStaging(db.database).state()).cursor).toBe("2");
	});
});
