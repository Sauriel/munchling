import type { CreateFoodInput, CreateMealLogInput, CreateProfileInput, CreateRecipeInput, RecipeIngredientInput, UpdateFoodInput, UpdateProfileInput, UpdateRecipeInput } from "./types";

export type ValidationCode = "required" | "invalidType" | "invalidNumber" | "invalidDate" | "invalidSource" | "duplicate" | "reference" | "cycle" | "backupFormat" | "backupLimit";

export class DomainValidationError extends Error {
	constructor(public readonly code: ValidationCode, public readonly field: string) {
		super(`${field}: ${code}`);
		this.name = "DomainValidationError";
	}
}

export function validationMessage(error: unknown, translate: (key: string) => string) {
	return translate(error instanceof DomainValidationError ? `validation.${error.code}` : "validation.failed");
}

export function fail(code: ValidationCode, field: string): never { throw new DomainValidationError(code, field); }
export function assertRecord(value: unknown, field = "input"): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalidType", field);
}
export function assertText(value: unknown, field: string, required = false): asserts value is string {
	if (typeof value !== "string") fail("invalidType", field);
	if (required && !value.trim()) fail("required", field);
}
export function assertNumber(value: unknown, field: string, positive = false): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) fail("invalidNumber", field);
}
export function assertId(value: unknown, field = "id"): asserts value is number {
	assertNumber(value, field, true);
	if (!Number.isSafeInteger(value)) fail("invalidNumber", field);
}
export function assertDateTime(value: unknown, field: string): asserts value is string {
	assertText(value, field, true);
	// SQLite timestamps, datetime-local and ISO timestamps with optional offset.
	const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(value);
	if (!match) fail("invalidDate", field);
	const [, year, month, day, hour, minute, second, zoneHour, zoneMinute] = match;
	const y = Number(year), m = Number(month), d = Number(day);
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	if (y < 1 || m < 1 || m > 12 || d < 1 || d > days || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59 || Number(zoneHour ?? 0) > 23 || Number(zoneMinute ?? 0) > 59) fail("invalidDate", field);
}

function optionalText(value: unknown, field: string) { if (value !== undefined && value !== null) assertText(value, field); }
function optionalBoolean(value: unknown, field: string) { if (value !== undefined && typeof value !== "boolean") fail("invalidType", field); }
function names(input: Record<string, unknown>, partial: boolean) {
	for (const key of ["nameDe", "nameEn"]) if (!partial || input[key] !== undefined) assertText(input[key], key, true);
}

export function validateProfileInput(input: unknown, partial = false): asserts input is CreateProfileInput | UpdateProfileInput {
	assertRecord(input);
	if (!partial || input.name !== undefined) assertText(input.name, "name", true);
	if (!partial || input.dailyCaloriesTarget !== undefined) {
		assertNumber(input.dailyCaloriesTarget, "dailyCaloriesTarget");
		if (!Number.isSafeInteger(input.dailyCaloriesTarget)) fail("invalidNumber", "dailyCaloriesTarget");
	}
	for (const key of ["dailyProteinTarget", "dailyCarbsTarget", "dailyFatTarget", "dailySugarTarget", "dailyFiberTarget", "dailySaltTarget"]) {
		if (input[key] !== undefined && input[key] !== null) assertNumber(input[key], key);
	}
}
export function validateFoodInput(input: unknown, partial = false): asserts input is CreateFoodInput | UpdateFoodInput {
	assertRecord(input);
	names(input, partial);
	optionalText(input.brand, "brand");
	optionalText(input.ean, "ean"); // Blank optional strings are normalized to NULL by the adapter.
	optionalBoolean(input.isCustom, "isCustom");
	for (const key of ["caloriesPer100g", "fatPer100g", "carbsPer100g", "sugarPer100g", "fiberPer100g", "proteinPer100g", "saltPer100g"]) {
		if (!partial || input[key] !== undefined) assertNumber(input[key], key);
	}
}
export function validateIngredientInput(input: unknown): asserts input is RecipeIngredientInput {
	assertRecord(input);
	assertNumber(input.amountGrams, "amountGrams", true);
	const food = input.foodId != null, recipe = input.subRecipeId != null;
	if (food === recipe) fail("invalidSource", "ingredient");
	if (food) assertId(input.foodId, "foodId");
	if (recipe) assertId(input.subRecipeId, "subRecipeId");
}
export function validateIngredients(value: unknown): asserts value is RecipeIngredientInput[] {
	if (!Array.isArray(value)) fail("invalidType", "ingredients");
	for (const ingredient of value) validateIngredientInput(ingredient);
}
export function validateRecipeInput(input: unknown, partial = false): asserts input is CreateRecipeInput | UpdateRecipeInput {
	assertRecord(input);
	names(input, partial);
	optionalText(input.description, "description");
	optionalBoolean(input.isSubRecipe, "isSubRecipe");
	if (input.ingredients !== undefined) validateIngredients(input.ingredients);
}
export function validateMealInput(input: unknown): asserts input is CreateMealLogInput {
	assertRecord(input);
	const food = input.foodId != null, recipe = input.recipeId != null;
	if (food === recipe) fail("invalidSource", "meal");
	if (food) assertId(input.foodId, "foodId");
	if (recipe) assertId(input.recipeId, "recipeId");
	if (input.loggedAt !== undefined && input.loggedAt !== null) assertDateTime(input.loggedAt, "loggedAt");
	if (!Array.isArray(input.profiles) || input.profiles.length === 0) fail("required", "profiles");
	const seen = new Set<number>();
	let total = 0;
	for (const profile of input.profiles) {
		assertRecord(profile, "profiles");
		assertId(profile.profileId, "profileId");
		assertNumber(profile.portionGrams, "portionGrams", true);
		if (seen.has(profile.profileId)) fail("duplicate", "profileId");
		seen.add(profile.profileId);
		total += profile.portionGrams;
	}
	const roundedTotal = Math.round(total * 100) / 100;
	if (!Number.isFinite(roundedTotal) || roundedTotal <= 0) fail("invalidNumber", "totalWeightGrams");
}

export async function validateEanUniqueness(ean: string | null | undefined, ownId: number | null, find: (ean: string) => Promise<{ id: number } | null>) {
	const normalized = ean?.trim();
	if (!normalized) return;
	const existing = await find(normalized);
	if (existing && existing.id !== ownId) fail("duplicate", "ean");
}

export interface ReferenceLookup {
	hasFood(id: number): Promise<boolean>;
	hasRecipe(id: number): Promise<boolean>;
	hasProfile(id: number): Promise<boolean>;
}
export async function validateIngredientReferences(input: RecipeIngredientInput, lookup: ReferenceLookup) {
	if (input.foodId != null && !await lookup.hasFood(input.foodId)) fail("reference", "foodId");
	if (input.subRecipeId != null && !await lookup.hasRecipe(input.subRecipeId)) fail("reference", "subRecipeId");
}
export async function validateMealReferences(input: CreateMealLogInput, lookup: ReferenceLookup) {
	if (input.foodId != null && !await lookup.hasFood(input.foodId)) fail("reference", "foodId");
	if (input.recipeId != null && !await lookup.hasRecipe(input.recipeId)) fail("reference", "recipeId");
	for (const profile of input.profiles) if (!await lookup.hasProfile(profile.profileId)) fail("reference", "profileId");
}

// Iterative topological sort avoids recursive stack overflow for imported graphs.
export function validateRecipeGraph<Id extends number | string>(edges: ReadonlyArray<{ recipeId: Id; subRecipeId: Id | null }>) {
	const children = new Map<Id, Id[]>();
	const incoming = new Map<Id, number>();
	for (const edge of edges) {
		if (edge.subRecipeId === null) continue;
		const targets = children.get(edge.recipeId) ?? [];
		targets.push(edge.subRecipeId);
		children.set(edge.recipeId, targets);
		incoming.set(edge.recipeId, incoming.get(edge.recipeId) ?? 0);
		incoming.set(edge.subRecipeId, (incoming.get(edge.subRecipeId) ?? 0) + 1);
	}
	const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
	for (let i = 0; i < queue.length; i++) {
		for (const id of children.get(queue[i]!) ?? []) {
			const remaining = incoming.get(id)! - 1;
			incoming.set(id, remaining);
			if (remaining === 0) queue.push(id);
		}
	}
	if (queue.length !== incoming.size) fail("cycle", "recipes");
}
