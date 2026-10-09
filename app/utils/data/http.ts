import { validateActivity, validateActivityLog, activityTotals, type ActivityInput, type ActivityLogInput } from '../../../shared/domain/activities';
import type { MunchlingDataService } from "../../../shared/domain/data-service";
import type { CreateFoodInput, CreateProfileInput, CreateRecipeInput, CreateMealLogInput, RecipeIngredientInput } from "../../../shared/domain/types";
import type { SyncAggregate } from "../../../shared/domain/sync";
import { createUuid } from "../../../shared/domain/sync";
import type { ServerWriteBatch } from "../../../shared/domain/server";
import { normalizeWriteBatch } from "../../../shared/domain/server-validation";
import { validateFoodInput, validateProfileInput, validateRecipeInput, validateMealInput } from "../../../shared/domain/validation";
import { SyncClientError } from "../../../shared/domain/replies";
import { createSyncHttpClient } from "../sync/http";
import { createWebView } from "./web-view";

type SimpleInput = Partial<CreateFoodInput> | Partial<CreateProfileInput> | Partial<CreateRecipeInput>;
type JournalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WebWriteLock = { run<T>(key: string, action: () => Promise<T>): Promise<T> };
export function createHttpDataService(address: string, storage: JournalStore, options: Parameters<typeof createSyncHttpClient>[1] & { lock?: WebWriteLock } = {}) {
	const client = createSyncHttpClient(address, options), key = `munchling:web-write:${client.url}`;
	let view: ReturnType<typeof createWebView> | undefined, binding: { serverInstanceId: string; serverEpoch: string } | undefined, loading: Promise<ReturnType<typeof createWebView>> | undefined, busy = false, readFailed = false;
	async function refresh() {
		if (!loading) loading = (async () => { if (!binding) { const info = await client.info(); binding = { serverInstanceId: info.serverInstanceId, serverEpoch: info.serverEpoch }; } const next = createWebView(await client.webState(binding)); view = next; readFailed = false; return next; })().catch(error => { readFailed = true; throw error; }).finally(() => { loading = undefined; });
		return loading;
	}
	async function current() { return view ?? refresh(); }
	function pending(): { batch: ServerWriteBatch; confirmed: boolean } | null {
		const text = storage.getItem(key); if (text === null) return null;
		try { const value = JSON.parse(text); if (typeof value.confirmed !== "boolean") throw new Error(); return { batch: normalizeWriteBatch(value.batch), confirmed: value.confirmed }; } catch { throw new SyncClientError("writeJournalInvalid"); }
	}
	async function locked<T>(action: () => Promise<T>): Promise<T> {
		if (options.lock) return options.lock.run(key, action);
		if (!globalThis.navigator?.locks) throw new SyncClientError("secureContextRequired");
		return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => { if (!lock) throw new SyncClientError("unconfirmedUpload"); return action(); });
	}
	async function replay() {
		const journal = pending(); if (!journal) return;
		if (binding && (binding.serverInstanceId !== journal.batch.serverInstanceId || binding.serverEpoch !== journal.batch.serverEpoch)) throw new SyncClientError("serverChanged");
		if (!journal.confirmed) {
			try { await client.push(journal.batch); }
			catch (error) {
				// Only canonical transaction conflicts in the SAME binding prove
				// non-commit. Transport, origin, epoch and 5xx errors do not.
				if (error instanceof SyncClientError && (error.status === 409 && ["versionConflict", "dependencyConflict", "identityConflict"].includes(error.code) || error.status === 422 && ["reference", "duplicate", "cycle"].includes(error.code))) storage.removeItem(key);
				throw error;
			}
			storage.setItem(key, JSON.stringify({ ...journal, confirmed: true }));
		}
		binding ??= { serverInstanceId: journal.batch.serverInstanceId, serverEpoch: journal.batch.serverEpoch };
		if (loading) await loading;
		await refresh(); storage.removeItem(key);
	}
	async function write(entity: SyncAggregate, uuid: string, payload: Record<string, unknown>, revision = 0, remove = false) {
		return writeOperations([{ operationId: createUuid(), entity, entityUuid: uuid, baseRevision: revision, operation: remove ? 'delete' : 'upsert', payload }]);
	}
	async function writeOperations(operations: ServerWriteBatch['operations'], guards?: ServerWriteBatch['guards']) {
		return locked(async () => {
		if (busy || pending()) throw new SyncClientError("unconfirmedUpload"); busy = true;
		try {
			await current(); const batch = normalizeWriteBatch({ ...binding!, batchId: createUuid(), operations, ...(guards ? { guards } : {}) });
			// Must succeed before sending; never silently lose an uncertain write.
			storage.setItem(key, JSON.stringify({ batch, confirmed: false })); await replay();
			return view!;
		} finally { busy = false; }
		});
	}
	async function retryPendingWrite() { return locked(async () => { if (busy) throw new SyncClientError("unconfirmedUpload"); busy = true; try { await replay(); } finally { busy = false; } }); }
	async function selected(entity: SyncAggregate, id: number, revision?: number) {
		const v = await current(), root = v.root(entity, id);
		if (!Number.isSafeInteger(revision) || revision !== root.version) throw new SyncClientError("versionConflict");
		return { v, root };
	}
	const fields = {
		profiles: { name: "name", dailyCaloriesTarget: "daily_calories_target", dailyProteinTarget: "daily_protein_target", dailyCarbsTarget: "daily_carbs_target", dailyFatTarget: "daily_fat_target", dailySugarTarget: "daily_sugar_target", dailyFiberTarget: "daily_fiber_target", dailySaltTarget: "daily_salt_target" },
		foods: { nameDe: "name_de", nameEn: "name_en", brand: "brand", ean: "ean", caloriesPer100g: "calories_per_100g", fatPer100g: "fat_per_100g", carbsPer100g: "carbs_per_100g", sugarPer100g: "sugar_per_100g", fiberPer100g: "fiber_per_100g", proteinPer100g: "protein_per_100g", saltPer100g: "salt_per_100g", isCustom: "is_custom", portionSizeGrams: "portion_size_grams" },
		recipes: { nameDe: "name_de", nameEn: "name_en", description: "description", isSubRecipe: "is_sub_recipe", portionSizeGrams: "portion_size_grams" },
	};
	function mapped(entity: keyof typeof fields, input: SimpleInput, old?: Record<string, unknown>) {
		const timestamp = new Date().toISOString(), data: Record<string, unknown> = old ? { ...old, updated_at: timestamp } : { id: createUuid(), created_at: timestamp, updated_at: null };
		for (const [key, field] of Object.entries(fields[entity])) {
			const value = (input as Record<string, unknown>)[key]; if (old && value === undefined) continue;
			data[field] = field.startsWith("is_") ? Number(value ?? (entity === "foods")) : typeof value === "string" ? (["brand", "ean", "description"].includes(field) ? value.trim() || null : value.trim()) : value ?? null;
		}
		return data;
	}
	function ingredients(v: Awaited<ReturnType<typeof current>>, parent: string, inputs: RecipeIngredientInput[]) {
		return inputs.map(input => ({ id: createUuid(), recipe_id: parent, food_id: input.foodId === undefined ? null : v.uuid("foods", input.foodId), sub_recipe_id: input.subRecipeId === undefined ? null : v.uuid("recipes", input.subRecipeId), amount_grams: input.amountGrams, created_at: new Date().toISOString() }));
	}
	async function saveSimple(entity: "profiles" | "foods" | "recipes", input: SimpleInput, id?: number, revision?: number) {
		const v = await current(), old = id === undefined ? undefined : (await selected(entity, id, revision)).root;
		if (entity === "profiles") validateProfileInput(input, !!old); if (entity === "foods") validateFoodInput(input, !!old); if (entity === "recipes") validateRecipeInput(input, !!old);
		const data = mapped(entity, input, old?.data ?? undefined);
		if (entity === "recipes") { const children = (input as CreateRecipeInput).ingredients; if (children !== undefined || !old) data.ingredients = ingredients(v, String(data.id), children ?? []); }
		const after = await write(entity, String(data.id), data, old?.version ?? 0); return after.id(data.id);
	}
	async function remove(entity: SyncAggregate, id: number, revision?: number) {
		const { root } = await selected(entity, id, revision);
		// Initially no browser cascade: server will reject referenced deletes.
		// Never add fresh guard revisions behind an old confirmation dialog.
		await write(entity, root.id, { id: root.id, deleted_at: new Date().toISOString() }, root.version, true); return 1;
	}
	async function saveMeal(input: CreateMealLogInput, id?: number, revision?: number) {
		validateMealInput(input); const v = await current(), old = id === undefined ? undefined : (await selected("meal_logs", id, revision)).root;
		const uuid = old?.id ?? createUuid(), timestamp = new Date().toISOString(), total = Math.round(input.profiles.reduce((sum, p) => sum + p.portionGrams, 0) * 100) / 100;
		const payload = { id: uuid, created_at: old?.data?.created_at ?? timestamp, updated_at: old ? timestamp : null, logged_at: input.loggedAt ?? old?.data?.logged_at ?? timestamp, food_id: input.foodId == null ? null : v.uuid("foods", input.foodId), recipe_id: input.recipeId == null ? null : v.uuid("recipes", input.recipeId), total_weight_grams: total,
			profiles: input.profiles.filter(p => p.portionGrams > 0).map(p => ({ id: createUuid(), meal_log_id: uuid, profile_id: v.uuid("profiles", p.profileId), portion_factor: p.portionGrams / total, created_at: timestamp })) };
		const next = await write("meal_logs", uuid, payload, old?.version ?? 0); return next.read.mealLogs.getMealLogById(next.id(uuid));
	}
	async function changeChild(childId: number, input: RecipeIngredientInput | null, revision?: number) {
		const v = await current(), child = await v.read.recipes.getRecipeIngredientById(childId); if (!child) throw new SyncClientError("reference");
		const { root } = await selected("recipes", child.recipeId, revision), data = structuredClone(root.data!); const children = data.ingredients as Record<string, unknown>[], uuid = v.uuid("recipe_ingredients", childId);
		data.ingredients = children.flatMap(row => row.id !== uuid ? [row] : input ? [{ ...ingredients(v, root.id, [input])[0]!, id: uuid, created_at: row.created_at }] : []); data.updated_at = new Date().toISOString();
		await write("recipes", root.id, data, root.version); return input ? view!.read.recipes.getRecipeIngredientById(childId) : 1;
	}
	async function saveActivity(input: ActivityInput, id?: number, revision?: number) {
		validateActivity(input); const old = id === undefined ? undefined : (await selected('activities', id, revision)).root;
		const data = { id: old?.id ?? createUuid(), name: input.name.trim(), duration_minutes: input.durationMinutes, calories: input.calories, created_at: old?.data?.created_at ?? new Date().toISOString(), updated_at: old ? new Date().toISOString() : null };
		const v = await write('activities', data.id, data, old?.version ?? 0); return v.read.activities.getActivityById(v.id(data.id));
	}
	async function saveActivityLogs(input: ActivityLogInput) {
		validateActivityLog(input); const { v, root } = await selected('activities', input.activityId, input.activityRevision);
		const activity = (await v.read.activities.getActivityById(input.activityId))!;
		const operations = input.profiles.map(row => {
			activityTotals(activity, row.units); const uuid = createUuid();
			return { operationId: createUuid(), entity: 'activity_logs' as const, entityUuid: uuid, baseRevision: 0, operation: 'upsert' as const, payload: { id: uuid, profile_id: v.uuid('profiles', row.profileId), date: input.date, name: activity.name, duration_minutes: activity.durationMinutes, calories: activity.calories, units: row.units, created_at: new Date().toISOString(), updated_at: null } };
		});
		const next = await writeOperations(operations, [{ entity: 'activities', entityUuid: root.id, baseRevision: root.version }]);
		const ids = new Set(operations.map(o => next.id(o.entityUuid))); return (await next.read.activityLogs.listActivityLogs()).filter(row => ids.has(row.id));
	}
	const service: MunchlingDataService = {
		activities: { listActivities: async () => (await refresh()).read.activities.listActivities(), getActivityById: async id => (await current()).read.activities.getActivityById(id), createActivity: input => saveActivity(input), updateActivity: (id,input,revision) => saveActivity(input,id,revision), deleteActivity: (id,revision) => remove('activities',id,revision) },
		activityLogs: { listActivityLogs: async () => (await refresh()).read.activityLogs.listActivityLogs(), createActivityLogs: saveActivityLogs, deleteActivityLog: (id,revision) => remove('activity_logs',id,revision) },
		profiles: { listProfiles: async () => (await refresh()).read.profiles.listProfiles(), getProfileById: async id => (await current()).read.profiles.getProfileById(id), createProfile: async input => { const id = await saveSimple("profiles", input); return view!.read.profiles.getProfileById(id); }, updateProfile: async (id, input, revision) => { await saveSimple("profiles", input, id, revision); return view!.read.profiles.getProfileById(id); }, deleteProfile: (id, revision) => remove("profiles", id, revision) },
		foods: { listFoods: async search => (await refresh()).read.foods.listFoods(search), getFoodById: async id => (await current()).read.foods.getFoodById(id), getFoodByEan: async ean => (await current()).read.foods.getFoodByEan(ean), getFoodByNameDe: async name => (await current()).read.foods.getFoodByNameDe(name), createFood: async input => { const id = await saveSimple("foods", input); return view!.read.foods.getFoodById(id); }, updateFood: async (id, input, revision) => { await saveSimple("foods", input, id, revision); return view!.read.foods.getFoodById(id); }, deleteFood: (id, revision) => remove("foods", id, revision) },
		recipes: { listRecipes: async () => (await refresh()).read.recipes.listRecipes(), getRecipeById: async id => (await current()).read.recipes.getRecipeById(id), getRecipeWithIngredients: async id => (await current()).read.recipes.getRecipeWithIngredients(id), listRecipeIngredients: async id => (await current()).read.recipes.listRecipeIngredients(id), getRecipeIngredientById: async id => (await current()).read.recipes.getRecipeIngredientById(id), calculateRecipeNutrition: async id => (await current()).read.recipes.calculateRecipeNutrition(id), createRecipe: async input => { const id = await saveSimple("recipes", input); return view!.read.recipes.getRecipeWithIngredients(id); }, updateRecipe: async (id, input, revision) => { await saveSimple("recipes", input, id, revision); return view!.read.recipes.getRecipeWithIngredients(id); }, deleteRecipe: (id, revision) => remove("recipes", id, revision), replaceRecipeIngredients: async (id, inputs, revision) => { await saveSimple("recipes", { ingredients: inputs }, id, revision); return view!.read.recipes.listRecipeIngredients(id); }, addRecipeIngredient: async (id, input, revision) => { const { v, root } = await selected("recipes", id, revision); const child = ingredients(v, root.id, [input])[0]!; await write("recipes", root.id, { ...root.data, updated_at: new Date().toISOString(), ingredients: [...root.data!.ingredients as Record<string, unknown>[], child] }, root.version); return view!.read.recipes.getRecipeIngredientById(view!.id(child.id)); }, updateRecipeIngredient: async (id, input, revision) => await changeChild(id, input, revision) as Awaited<ReturnType<MunchlingDataService["recipes"]["getRecipeIngredientById"]>>, deleteRecipeIngredient: async (id, revision) => await changeChild(id, null, revision) as number },
		mealLogs: { listMealLogs: async filter => (await refresh()).read.mealLogs.listMealLogs(filter), getMealLogById: async id => (await current()).read.mealLogs.getMealLogById(id), createMealLog: input => saveMeal(input), updateMealLog: (id, input, revision) => saveMeal(input, id, revision), deleteMealLog: (id, revision) => remove("meal_logs", id, revision) },
	};
	return { ...service, hasReadError: () => readFailed, hasPendingWrite: () => pending() !== null, retryPendingWrite };
}
