import type { Food, Profile, Recipe, RecipeIngredient } from "./types";
import { isUuid, syncEntities, type SyncIdentity, type SyncTombstone } from "./sync";
import { assertDateTime, assertId, assertNumber, assertRecord, assertText, fail, validateFoodInput, validateIngredientInput, validateProfileInput, validateRecipeGraph, validateRecipeInput } from "./validation";

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_ROWS = 100_000;

export type StoredMealLog = {
	id: number; loggedAt: string; foodId: number | null; recipeId: number | null;
	totalWeightGrams: number; createdAt: string; updatedAt: string | null;
};
export type StoredMealLogProfile = {
	id: number; mealLogId: number; profileId: number; portionFactor: number; createdAt: string;
};
export type BackupData = {
	profiles: Profile[]; foods: Food[]; recipes: Recipe[];
	recipeIngredients: RecipeIngredient[]; mealLogs: StoredMealLog[]; mealLogProfiles: StoredMealLogProfile[];
};
type BackupBase = { format: "munchling-backup"; exportedAt: string; data: BackupData };
export type LegacyBackup = BackupBase & { version: 1; schemaVersion: 1 };
export type IdentityBackup = BackupBase & { version: 2; schemaVersion: 2; identities: SyncIdentity[]; tombstones: SyncTombstone[] };
export type MunchlingBackup = LegacyBackup | IdentityBackup;

function nullableText(value: unknown, field: string) { if (value !== null) assertText(value, field); }
function nullableDate(value: unknown, field: string) { if (value !== null) assertDateTime(value, field); }
function timestamps(row: Record<string, unknown>, updated = true) {
	assertDateTime(row.createdAt, "createdAt");
	if (updated) nullableDate(row.updatedAt, "updatedAt");
}
function ids(rows: Record<string, unknown>[], field: string) {
	const seen = new Set<number>();
	for (const row of rows) {
		assertId(row.id, `${field}.id`);
		if (seen.has(row.id)) fail("duplicate", `${field}.id`);
		seen.add(row.id);
	}
	return seen;
}
function reference(value: unknown, allowed: Set<number>, field: string) {
	assertId(value, field);
	if (!allowed.has(value)) fail("reference", field);
}

export function validateBackup(value: unknown): asserts value is MunchlingBackup {
	assertRecord(value, "backup");
	if (value.format !== "munchling-backup" || !((value.version === 1 && value.schemaVersion === 1) || (value.version === 2 && value.schemaVersion === 2))) fail("backupFormat", "backup");
	assertDateTime(value.exportedAt, "exportedAt");
	assertRecord(value.data, "data");
	const tables = ["profiles", "foods", "recipes", "recipeIngredients", "mealLogs", "mealLogProfiles"] as const;
	const rows = {} as Record<typeof tables[number], Record<string, unknown>[]>;
	let count = 0;
	for (const table of tables) {
		const entries = value.data[table];
		if (!Array.isArray(entries)) fail("invalidType", table);
		count += entries.length;
		if (count > MAX_BACKUP_ROWS) fail("backupLimit", "backup");
		for (const entry of entries) assertRecord(entry, table);
		rows[table] = entries;
	}
	const profiles = ids(rows.profiles, "profiles"), foods = ids(rows.foods, "foods"), recipes = ids(rows.recipes, "recipes");
	const meals = ids(rows.mealLogs, "mealLogs");
	ids(rows.recipeIngredients, "recipeIngredients");
	ids(rows.mealLogProfiles, "mealLogProfiles");

	for (const row of rows.profiles) {
		validateProfileInput(row);
		for (const key of ["dailyProteinTarget", "dailyCarbsTarget", "dailyFatTarget", "dailySugarTarget", "dailyFiberTarget", "dailySaltTarget"] as const) {
			if (row[key] !== null) assertNumber(row[key], key);
		}
		timestamps(row);
	}
	const eans = new Set<string>();
	for (const row of rows.foods) {
		validateFoodInput(row);
		nullableText(row.brand, "brand");
		if (row.ean !== null) {
			assertText(row.ean, "ean", true);
			if (row.ean !== row.ean.trim()) fail("backupFormat", "ean");
			if (eans.has(row.ean)) fail("duplicate", "ean");
			eans.add(row.ean);
		}
		if (typeof row.isCustom !== "boolean") fail("invalidType", "isCustom");
		timestamps(row);
	}
	for (const row of rows.recipes) {
		validateRecipeInput(row);
		nullableText(row.description, "description");
		if (typeof row.isSubRecipe !== "boolean") fail("invalidType", "isSubRecipe");
		timestamps(row);
	}
	for (const row of rows.recipeIngredients) {
		reference(row.recipeId, recipes, "recipeId");
		validateIngredientInput(row);
		if (row.foodId !== null) reference(row.foodId, foods, "foodId");
		if (row.subRecipeId !== null) reference(row.subRecipeId, recipes, "subRecipeId");
		timestamps(row, false);
	}
	validateRecipeGraph(rows.recipeIngredients.map((row) => ({ recipeId: row.recipeId as number, subRecipeId: row.subRecipeId as number | null })));
	for (const row of rows.mealLogs) {
		if ((row.foodId !== null) === (row.recipeId !== null)) fail("invalidSource", "meal");
		if (row.foodId !== null) reference(row.foodId, foods, "foodId");
		if (row.recipeId !== null) reference(row.recipeId, recipes, "recipeId");
		assertNumber(row.totalWeightGrams, "totalWeightGrams", true);
		assertDateTime(row.loggedAt, "loggedAt");
		timestamps(row);
	}
	const pairs = new Set<string>();
	for (const row of rows.mealLogProfiles) {
		reference(row.mealLogId, meals, "mealLogId");
		reference(row.profileId, profiles, "profileId");
		assertNumber(row.portionFactor, "portionFactor", true);
		const pair = `${row.mealLogId}:${row.profileId}`;
		if (pairs.has(pair)) fail("duplicate", "mealLogProfiles");
		pairs.add(pair);
		timestamps(row, false);
	}
	if (value.version === 2) validateIdentities(value, rows, count);
	// Existing profile deletion can leave a meal with zero/fewer profile links.
	// Backups preserve that stored state; they do not recalculate portions.
}

function validateIdentities(value: Record<string, unknown>, rows: Record<string, Record<string, unknown>[]>, count: number) {
	if (!Array.isArray(value.identities) || !Array.isArray(value.tombstones)) fail("backupFormat", "identities");
	if (value.identities.length !== count) fail("backupFormat", "identities");
	if (count + value.tombstones.length > MAX_BACKUP_ROWS) fail("backupLimit", "tombstones");
	const tableNames = { profiles: "profiles", foods: "foods", recipes: "recipes", recipe_ingredients: "recipeIngredients", meal_logs: "mealLogs", meal_log_profiles: "mealLogProfiles" };
	const expected = new Set<string>();
	for (const entity of syncEntities) for (const row of rows[tableNames[entity]]!) expected.add(`${entity}:${row.id}`);
	const seen = new Map<string, string>();
	for (const identity of value.identities) {
		assertRecord(identity, "identity");
		assertId(identity.localId, "localId");
		if (!isUuid(identity.uuid) || !syncEntities.includes(identity.entity as typeof syncEntities[number])) fail("backupFormat", "identity");
		const key = `${identity.entity}:${identity.localId}`;
		if (!expected.delete(key) || seen.has(identity.uuid)) fail("duplicate", "identity");
		seen.set(identity.uuid, String(identity.entity));
	}
	if (expected.size) fail("reference", "identities");
	for (const tombstone of value.tombstones) {
		assertRecord(tombstone, "tombstone");
		if (!isUuid(tombstone.uuid) || !isUuid(tombstone.aggregateUuid) || !syncEntities.includes(tombstone.entity as typeof syncEntities[number])) fail("backupFormat", "tombstone");
		if (seen.has(tombstone.uuid)) fail("duplicate", "tombstone");
		assertDateTime(tombstone.deletedAt, "deletedAt");
		seen.set(tombstone.uuid, String(tombstone.entity));
	}
	for (const tombstone of value.tombstones) {
		const root = tombstone.entity === "recipe_ingredients" ? "recipes" : tombstone.entity === "meal_log_profiles" ? "meal_logs" : tombstone.entity;
		if (tombstone.aggregateEntity !== root || seen.get(tombstone.aggregateUuid) !== root) fail("reference", "aggregateUuid");
		if (tombstone.entity === root && tombstone.aggregateUuid !== tombstone.uuid) fail("reference", "aggregateUuid");
	}
}

export function parseBackupJson(text: string): MunchlingBackup {
	if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) fail("backupLimit", "backup");
	let value: unknown;
	try { value = JSON.parse(text); } catch { fail("backupFormat", "backup"); }
	validateBackup(value);
	return value;
}

export function cloneBackup(value: unknown): MunchlingBackup {
	let text: string | undefined;
	try { text = JSON.stringify(value); } catch { fail("backupFormat", "backup"); }
	if (text === undefined) fail("backupFormat", "backup");
	return parseBackupJson(text);
}

export interface LocalBackupService {
	exportBackup(): Promise<MunchlingBackup>;
	// The caller must durably save this snapshot BEFORE any deletion. A rejected
	// save aborts the restore. This snapshot shares the restore's exclusive lock.
	restoreBackup(value: unknown, savePrevious: (backup: MunchlingBackup) => Promise<void>): Promise<void>;
}
