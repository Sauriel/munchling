import type { LocalBackupService, MunchlingBackup, StoredMealLog, StoredMealLogProfile } from "../../../shared/domain/backup";
import { cloneBackup } from "../../../shared/domain/backup";
import { fail } from "../../../shared/domain/validation";
import { schemaMigrations } from "./schema";
import { createUuid, type SyncIdentity, type SyncTombstone, type SyncEntity } from "../../../shared/domain/sync";
import type { Food, Profile, Recipe, RecipeIngredient } from "../../../shared/domain/types";
import { fromSqlBoolean, toSqlBoolean, type SqlDatabase, type SqlExecutor } from "./executor";

export async function snapshotBackup(sql: SqlExecutor): Promise<MunchlingBackup> {
	const applied = await sql.query<{ version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations;");
	const version = Number(applied[0]?.version ?? 0);
	if (version > schemaMigrations.at(-1)!.version) fail("backupFormat", "schemaVersion");
	const profiles = await sql.query<Profile>(
		`SELECT id, name, daily_calories_target AS dailyCaloriesTarget,
		 daily_protein_target AS dailyProteinTarget, daily_carbs_target AS dailyCarbsTarget,
		 daily_fat_target AS dailyFatTarget, daily_sugar_target AS dailySugarTarget,
		 daily_fiber_target AS dailyFiberTarget, daily_salt_target AS dailySaltTarget,
		 created_at AS createdAt, updated_at AS updatedAt FROM profiles ORDER BY id;`,
	);
	const foods = await sql.query<Omit<Food, "isCustom"> & { isCustom: number }>(
		`SELECT id, name_de AS nameDe, name_en AS nameEn, brand, ean,
		 calories_per_100g AS caloriesPer100g, fat_per_100g AS fatPer100g,
		 carbs_per_100g AS carbsPer100g, sugar_per_100g AS sugarPer100g,
		 fiber_per_100g AS fiberPer100g, protein_per_100g AS proteinPer100g,
		 salt_per_100g AS saltPer100g, is_custom AS isCustom,
		 created_at AS createdAt, updated_at AS updatedAt FROM foods ORDER BY id;`,
	);
	const recipes = await sql.query<Omit<Recipe, "isSubRecipe"> & { isSubRecipe: number }>(
		`SELECT id, name_de AS nameDe, name_en AS nameEn, description, is_sub_recipe AS isSubRecipe,
		 created_at AS createdAt, updated_at AS updatedAt FROM recipes ORDER BY id;`,
	);
	const recipeIngredients = await sql.query<RecipeIngredient>(
		`SELECT id, recipe_id AS recipeId, food_id AS foodId, sub_recipe_id AS subRecipeId,
		 amount_grams AS amountGrams, created_at AS createdAt FROM recipe_ingredients ORDER BY id;`,
	);
	const mealLogs = await sql.query<StoredMealLog>(
		`SELECT id, logged_at AS loggedAt, food_id AS foodId, recipe_id AS recipeId,
		 total_weight_grams AS totalWeightGrams, created_at AS createdAt, updated_at AS updatedAt
		 FROM meal_logs ORDER BY id;`,
	);
	const mealLogProfiles = await sql.query<StoredMealLogProfile>(
		`SELECT id, meal_log_id AS mealLogId, profile_id AS profileId, portion_factor AS portionFactor,
		 created_at AS createdAt FROM meal_log_profiles ORDER BY id;`,
	);
	const base = {
		format: "munchling-backup" as const, exportedAt: new Date().toISOString(),
		data: {
			profiles, foods: foods.map((row) => ({ ...row, isCustom: fromSqlBoolean(row.isCustom) })),
			recipes: recipes.map((row) => ({ ...row, isSubRecipe: fromSqlBoolean(row.isSubRecipe) })),
			recipeIngredients, mealLogs, mealLogProfiles,
		},
	};
	if (version < 2) return { ...base, version: 1, schemaVersion: 1 };
	const identities = await sql.query<SyncIdentity>("SELECT entity,local_id AS localId,uuid FROM sync_records WHERE deleted_at IS NULL ORDER BY entity,local_id;");
	const tombstones = await sql.query<SyncTombstone>("SELECT entity,uuid,aggregate_entity AS aggregateEntity,aggregate_uuid AS aggregateUuid,deleted_at AS deletedAt FROM sync_records WHERE deleted_at IS NOT NULL ORDER BY entity,uuid;");
	return { ...base, version: 2, schemaVersion: 2, identities, tombstones };
}

async function replaceData(sql: SqlExecutor, backup: MunchlingBackup) {
	const identities = new Map(backup.version === 2 ? backup.identities.map((identity) => [`${identity.entity}:${identity.localId}`, identity.uuid]) : []);
	const uuid = (entity: SyncEntity, id: number) => identities.get(`${entity}:${id}`) ?? null;
	await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;");
	// Children first; never disable foreign keys and never execute imported SQL.
	await sql.run("DELETE FROM meal_log_profiles;");
	await sql.run("DELETE FROM meal_logs;");
	await sql.run("DELETE FROM recipe_ingredients;");
	await sql.run("DELETE FROM recipes;");
	await sql.run("DELETE FROM foods;");
	await sql.run("DELETE FROM profiles;");
	await sql.run("DELETE FROM sync_outbox;");
	await sql.run("DELETE FROM sync_baselines;");
	await sql.run("DELETE FROM sync_conflicts;");
	await sql.run("DELETE FROM sync_dirty;");
	await sql.run("DELETE FROM sync_records;");
	for (const row of backup.data.profiles) {
		await sql.run(
			`INSERT INTO profiles (id, name, daily_calories_target, daily_protein_target, daily_carbs_target,
			 daily_fat_target, daily_sugar_target, daily_fiber_target, daily_salt_target, created_at, updated_at, uuid)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			[row.id, row.name, row.dailyCaloriesTarget, row.dailyProteinTarget, row.dailyCarbsTarget,
				row.dailyFatTarget, row.dailySugarTarget, row.dailyFiberTarget, row.dailySaltTarget, row.createdAt, row.updatedAt, uuid("profiles", row.id)],
		);
	}
	for (const row of backup.data.foods) {
		await sql.run(
			`INSERT INTO foods (id, name_de, name_en, brand, ean, calories_per_100g, fat_per_100g,
			 carbs_per_100g, sugar_per_100g, fiber_per_100g, protein_per_100g, salt_per_100g, is_custom, created_at, updated_at, uuid)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			[row.id, row.nameDe, row.nameEn, row.brand, row.ean, row.caloriesPer100g, row.fatPer100g,
				row.carbsPer100g, row.sugarPer100g, row.fiberPer100g, row.proteinPer100g, row.saltPer100g, toSqlBoolean(row.isCustom), row.createdAt, row.updatedAt, uuid("foods", row.id)],
		);
	}
	for (const row of backup.data.recipes) {
		await sql.run(
			"INSERT INTO recipes (id, name_de, name_en, description, is_sub_recipe, created_at, updated_at, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
			[row.id, row.nameDe, row.nameEn, row.description, toSqlBoolean(row.isSubRecipe), row.createdAt, row.updatedAt, uuid("recipes", row.id)],
		);
	}
	for (const row of backup.data.recipeIngredients) {
		await sql.run(
			"INSERT INTO recipe_ingredients (id, recipe_id, food_id, sub_recipe_id, amount_grams, created_at, uuid) VALUES (?, ?, ?, ?, ?, ?, ?);",
			[row.id, row.recipeId, row.foodId, row.subRecipeId, row.amountGrams, row.createdAt, uuid("recipe_ingredients", row.id)],
		);
	}
	for (const row of backup.data.mealLogs) {
		await sql.run(
			"INSERT INTO meal_logs (id, logged_at, food_id, recipe_id, total_weight_grams, created_at, updated_at, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
			[row.id, row.loggedAt, row.foodId, row.recipeId, row.totalWeightGrams, row.createdAt, row.updatedAt, uuid("meal_logs", row.id)],
		);
	}
	for (const row of backup.data.mealLogProfiles) {
		await sql.run(
			"INSERT INTO meal_log_profiles (id, meal_log_id, profile_id, portion_factor, created_at, uuid) VALUES (?, ?, ?, ?, ?, ?);",
			[row.id, row.mealLogId, row.profileId, row.portionFactor, row.createdAt, uuid("meal_log_profiles", row.id)],
		);
	}
	if (backup.version === 2) for (const row of backup.tombstones) {
		await sql.run("INSERT INTO sync_records (uuid,entity,aggregate_entity,aggregate_uuid,deleted_at) VALUES (?,?,?,?,?);", [row.uuid, row.entity, row.aggregateEntity, row.aggregateUuid, row.deletedAt]);
	}
	const schema = (await sql.query<{ version: number }>("SELECT MAX(version) AS version FROM schema_migrations;"))[0]!.version;
	if (schema >= 4) { await sql.run("DELETE FROM sync_upload;"); await sql.run("UPDATE sync_state SET draft_url=NULL WHERE id=1;"); }
	if (schema >= 3) {
		await sql.run("DELETE FROM sync_download;");
		await sql.run("DELETE FROM sync_inbox;");
		await sql.run("UPDATE sync_state SET server_epoch=NULL WHERE id=1;");
	}
	await sql.run("UPDATE sync_state SET enabled=0,development_seeded=0,server_url=NULL,server_instance_id=NULL,pull_cursor=NULL,local_epoch=?,tracking_enabled=1 WHERE id=1;", [createUuid()]);
	await sql.run("INSERT INTO sync_dirty (entity,uuid) SELECT entity,uuid FROM sync_records WHERE uuid=aggregate_uuid;");
}

export function createLocalBackupService(database: SqlDatabase): LocalBackupService {
	return {
		exportBackup: () => database.transaction(snapshotBackup),
		restoreBackup: async (value, savePrevious) => {
			// Validate and detach before taking the lock or touching existing data.
			const backup = cloneBackup(value);
			if (typeof savePrevious !== "function") throw new Error("A safety backup writer is required.");
			await database.transaction(async (sql) => {
				// A restore cannot erase the only evidence of an uncertain upload.
				if ((await sql.query("SELECT operation_id FROM sync_outbox WHERE status='inflight' LIMIT 1;")).length) throw new Error("unconfirmedUpload");
				if ((await sql.query("SELECT name FROM sqlite_master WHERE name='sync_upload';")).length && (await sql.query("SELECT id FROM sync_upload;")).length) throw new Error("unconfirmedUpload");
				const previous = await snapshotBackup(sql);
				await savePrevious(previous);
				await replaceData(sql, backup);
			});
		},
	};
}
