import { validateActivity, validateActivityDate, activityTotals } from './activities';
import type { ServerWriteBatch } from "./server";
import { isUuid, type SyncAggregate } from "./sync";
import { DomainValidationError, assertDateTime, assertNumber, assertRecord, assertText, fail, validateFoodInput, validateIngredientInput, validateProfileInput, validateRecipeInput } from "./validation";
import { wireColumns } from "./wire-columns";
type ServerTable = keyof typeof wireColumns;

export const aggregates: SyncAggregate[] = ["profiles", "foods", "recipes", "meal_logs", "activities", "activity_logs"];
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
	if (Object.keys(value).some((key) => !allowed.includes(key))) fail("invalidType", "fields");
}
function uuid(value: unknown, field: string): asserts value is string { if (!isUuid(value)) fail("invalidType", field); }
function revision(value: unknown) { assertNumber(value, "baseRevision"); if (!Number.isSafeInteger(value)) fail("invalidNumber", "baseRevision"); }
export function utcTimestamp(value: unknown, field: string): string {
	assertDateTime(value, field);
	const text = value.replace(" ", "T");
	const date = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`);
	if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) fail("invalidDate", field);
	return date.toISOString();
}
export function sqlTimestamp(value: string) { return value.replace("T", " ").replace("Z", ""); }
export function nullableText(value: unknown, field: string) { if (value == null) return null; assertText(value, field); return value.trim() || null; }
function nullableUuid(value: unknown, field: string) { if (value === null) return; uuid(value, field); }
function booleanFlag(value: unknown, field: string) { if (value !== 0 && value !== 1) fail("invalidType", field); return value === 1; }
function row(value: unknown, table: ServerTable, ids: Set<string>): Record<string, unknown> {
	assertRecord(value, table); uuid(value.id, "id");
	if (ids.has(value.id)) fail("duplicate", "id"); ids.add(value.id);
	const fields: readonly string[] = wireColumns[table];
	const extras = table === "recipes" ? ["ingredients"] : table === "meal_logs" ? ["profiles"] : [];
	for (const key of Object.keys(value)) if (key !== "id" && !fields.includes(key) && !extras.includes(key)) fail("invalidType", key);
	value.created_at = utcTimestamp(value.created_at, "created_at");
	if (fields.includes("updated_at")) value.updated_at = value.updated_at === null ? null : utcTimestamp(value.updated_at, "updated_at");
	return value;
}
function source(value: Record<string, unknown>, first: string, second: string) {
	nullableUuid(value[first], first); nullableUuid(value[second], second);
	if ((value[first] === null) === (value[second] === null)) fail("invalidSource", "source");
}
export function validatePayload(entity: SyncAggregate, value: Record<string, unknown>, ids: Set<string>): number {
	row(value, entity, ids);
	// Older persisted requests/history omit this additive field. Do not mutate
	// their payloads: immutable request hashes and receipts must still replay.
	if ((entity === "foods" || entity === "recipes") && value.portion_size_grams != null) assertNumber(value.portion_size_grams, "portion_size_grams", true);
	if (entity === "profiles") {
		validateProfileInput({ name: value.name, dailyCaloriesTarget: value.daily_calories_target, dailyProteinTarget: value.daily_protein_target, dailyCarbsTarget: value.daily_carbs_target, dailyFatTarget: value.daily_fat_target, dailySugarTarget: value.daily_sugar_target, dailyFiberTarget: value.daily_fiber_target, dailySaltTarget: value.daily_salt_target });
		for (const key of ["daily_protein_target", "daily_carbs_target", "daily_fat_target", "daily_sugar_target", "daily_fiber_target", "daily_salt_target"]) if (value[key] !== null) assertNumber(value[key], key);
		assertText(value.name, "name", true); value.name = value.name.trim();
	} else if (entity === "foods") {
		validateFoodInput({ nameDe: value.name_de, nameEn: value.name_en, brand: value.brand, ean: value.ean, caloriesPer100g: value.calories_per_100g, fatPer100g: value.fat_per_100g, carbsPer100g: value.carbs_per_100g, sugarPer100g: value.sugar_per_100g, fiberPer100g: value.fiber_per_100g, proteinPer100g: value.protein_per_100g, saltPer100g: value.salt_per_100g, isCustom: booleanFlag(value.is_custom, "is_custom") });
		value.brand = nullableText(value.brand, "brand"); value.ean = nullableText(value.ean, "ean");
		if (typeof value.ean === "string" && [...value.ean].length > 255) fail("invalidType", "ean");
		value.name_de = (value.name_de as string).trim(); value.name_en = (value.name_en as string).trim();
	} else if (entity === "recipes") {
		validateRecipeInput({ nameDe: value.name_de, nameEn: value.name_en, description: value.description, isSubRecipe: booleanFlag(value.is_sub_recipe, "is_sub_recipe") });
		value.description = nullableText(value.description, "description");
		if (!Array.isArray(value.ingredients)) fail("invalidType", "ingredients");
		for (const child of value.ingredients) {
			const ingredient = row(child, "recipe_ingredients", ids);
			if (ingredient.recipe_id !== value.id) fail("reference", "recipe_id");
			source(ingredient, "food_id", "sub_recipe_id");
			// Reuse numeric-ID-independent amount/source rules via dummy IDs;
			// actual UUID identities/references are checked separately.
			validateIngredientInput({ amountGrams: ingredient.amount_grams, foodId: ingredient.food_id === null ? null : 1, subRecipeId: ingredient.sub_recipe_id === null ? null : 1 });
		}
		value.name_de = (value.name_de as string).trim(); value.name_en = (value.name_en as string).trim();
		return value.ingredients.length;
	} else if (entity === 'activities' || entity === 'activity_logs') {
		const activity = { name: value.name, durationMinutes: value.duration_minutes, calories: value.calories };
		validateActivity(activity); value.name = activity.name.trim();
		if (entity === 'activity_logs') { uuid(value.profile_id, 'profile_id'); validateActivityDate(value.date); assertNumber(value.units, 'units', true); activityTotals(activity, value.units); }
	} else {
		source(value, "food_id", "recipe_id"); assertNumber(value.total_weight_grams, "total_weight_grams", true);
		// Historical datetime-local values have no known timezone. Attaching Z
		// would shift their displayed wall clock after a native/browser roundtrip.
		assertDateTime(value.logged_at, "logged_at");
		if (!Array.isArray(value.profiles)) fail("invalidType", "profiles");
		const profiles = new Set<string>();
		for (const child of value.profiles) {
			const portion = row(child, "meal_log_profiles", ids);
			uuid(portion.profile_id, "profile_id");
			if (portion.meal_log_id !== value.id) fail("reference", "meal_log_id");
			assertNumber(portion.portion_factor, "portion_factor", true);
			if (profiles.has(portion.profile_id)) fail("duplicate", "profile_id"); profiles.add(portion.profile_id);
		}
		// Stored meals may legitimately have zero/fewer portions after profile
		// deletion. Preserve exact factors/weight, never normalize them here.
		return value.profiles.length;
	}
	return 0;
}

export function normalizeWriteBatch(value: unknown): ServerWriteBatch {
	let text: string | undefined;
	try {
		text = JSON.stringify(value, (_key, item) => {
			if (typeof item === "number" && !Number.isFinite(item)) fail("invalidNumber", "batch");
			return item;
		});
	} catch (error) { if (error instanceof DomainValidationError) throw error; fail("invalidType", "batch"); }
	if (text === undefined) fail("invalidType", "batch");
	if (new TextEncoder().encode(text).byteLength > 25 * 1024 * 1024) fail("backupLimit", "batch");
	let input: unknown;
	try { input = JSON.parse(text); } catch { fail("invalidType", "batch"); }
	assertRecord(input, "batch"); fields(input, ["batchId", "serverInstanceId", "serverEpoch", "deviceId", "operations", "guards"]); uuid(input.batchId, "batchId"); uuid(input.serverInstanceId, "serverInstanceId"); uuid(input.serverEpoch, "serverEpoch");
	if (input.deviceId !== undefined) uuid(input.deviceId, "deviceId");
	if (!Array.isArray(input.operations) || input.operations.length === 0) fail("required", "operations");
	const operationIds = new Set<string>(), rootIds = new Set<string>(), allIds = new Set<string>(); let count = input.operations.length;
	for (const operation of input.operations) {
		assertRecord(operation, "operation"); fields(operation, ["operationId", "entity", "entityUuid", "baseRevision", "operation", "payload"]); uuid(operation.operationId, "operationId"); uuid(operation.entityUuid, "entityUuid"); revision(operation.baseRevision);
		if (!aggregates.includes(operation.entity as SyncAggregate) || !["upsert", "delete"].includes(String(operation.operation))) fail("invalidType", "operation");
		if (operationIds.has(operation.operationId) || rootIds.has(operation.entityUuid)) fail("duplicate", "operation");
		operationIds.add(operation.operationId); rootIds.add(operation.entityUuid);
		assertRecord(operation.payload, "payload");
		if (operation.payload.id !== operation.entityUuid) fail("reference", "id");
		if (operation.operation === "upsert") count += validatePayload(operation.entity as SyncAggregate, operation.payload, allIds);
		else { fields(operation.payload, ["id", "deleted_at"]); uuid(operation.payload.id, "id"); if (allIds.has(operation.payload.id)) fail("duplicate", "id"); allIds.add(operation.payload.id); if (operation.payload.deleted_at !== undefined) utcTimestamp(operation.payload.deleted_at, "deleted_at"); }
	}
	if (input.guards !== undefined) {
		if (!Array.isArray(input.guards)) fail("invalidType", "guards");
		const guarded = new Set<string>(); count += input.guards.length;
		for (const guard of input.guards) {
			assertRecord(guard, "guard"); fields(guard, ["entity", "entityUuid", "baseRevision"]); uuid(guard.entityUuid, "entityUuid"); revision(guard.baseRevision);
			if (!aggregates.includes(guard.entity as SyncAggregate)) fail("invalidType", "entity");
			if (guarded.has(guard.entityUuid) || rootIds.has(guard.entityUuid)) fail("duplicate", "guard"); guarded.add(guard.entityUuid);
		}
	}
	if (count > 100_000) fail("backupLimit", "batch");
	return input as ServerWriteBatch;
}
