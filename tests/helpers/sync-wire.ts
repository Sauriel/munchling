import { createUuid } from "../../shared/domain/sync";
import type { ServerAggregate } from "../../shared/domain/server";
import type { ChangePage, SnapshotIdentity, SnapshotPage } from "../../shared/domain/protocol";
export const date = "2026-10-05T12:00:00.000Z", url = "https://example.org", binding = { serverInstanceId: createUuid(), serverEpoch: createUuid() };
export const profile = (name = "Remote", id = createUuid(), version = 1): ServerAggregate => ({ entity: "profiles", id, version, deletedAt: null, data: { id, name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: date, updated_at: null } });
export const food = (ean: string | null = null, id = createUuid(), version = 1): ServerAggregate => ({ entity: "foods", id, version, deletedAt: null, data: { id, name_de: "Food", name_en: "Food", brand: null, ean, calories_per_100g: 100, fat_per_100g: 1, carbs_per_100g: 10, sugar_per_100g: 0, fiber_per_100g: 0, protein_per_100g: 10, salt_per_100g: 0, is_custom: 1, created_at: date, updated_at: null } });
export const recipe = (foodId: string, id = createUuid()): ServerAggregate => ({ entity: "recipes", id, version: 1, deletedAt: null, data: { id, name_de: "Recipe", name_en: "Recipe", description: null, is_sub_recipe: 0, created_at: date, updated_at: null, ingredients: [{ id: createUuid(), recipe_id: id, food_id: foodId, sub_recipe_id: null, amount_grams: 100, created_at: date }] } });
export function snapshot(roots: ServerAggregate[], cursor = "0"): SnapshotPage {
	const identities: SnapshotIdentity[] = roots.flatMap((row) => [{ uuid: row.id, entity: row.entity, aggregateUuid: row.id, version: row.version, deletedAt: row.deletedAt }, ...((row.data?.ingredients ?? row.data?.profiles ?? []) as Record<string, unknown>[]).map((child) => ({ uuid: String(child.id), entity: row.entity === "recipes" ? "recipe_ingredients" as const : "meal_log_profiles" as const, aggregateUuid: row.id, version: 1, deletedAt: null }))]);
	return { ...binding, protocolVersion: 1, snapshotId: createUuid(), cursor, expiresAt: "2099-10-05T12:00:00.000Z", page: 0, pageCount: 1, nextPage: null, aggregates: roots, identities };
}
export function page(roots: ServerAggregate[], from = 0): ChangePage {
	return { ...binding, protocolVersion: 1, fromCursor: String(from), cursor: String(from + roots.length), highWaterCursor: String(from + roots.length), hasMore: false, batches: [{ batchId: createUuid(), firstCursor: String(from + 1), lastCursor: String(from + roots.length), changes: roots.map((aggregate, i) => ({ cursor: String(from + i + 1), aggregate })) }] };
}
