import { wireColumns } from "../../../shared/domain/wire-columns";
import type { SyncEntity } from "../../../shared/domain/sync";
// SQL identifiers are compiled exclusively from this literal table allowlist
// and the frozen protocol field manifest. Wire values are always bound.
const tables = ["profiles", "foods", "recipes", "meal_logs", "recipe_ingredients", "meal_log_profiles", "activities", "activity_logs", 'profile_calorie_history'] as const;
export const receiveSql = Object.fromEntries(tables.map((table) => {
	const columns = wireColumns[table];
	return [table, {
		find: `SELECT id FROM ${table} WHERE uuid=?;`,
		update: `UPDATE ${table} SET ${columns.map((column) => `\`${column}\`=?`).join(",")} WHERE uuid=?;`,
		insert: `INSERT INTO ${table} (id,uuid,${columns.map(column => `\`${column}\``).join(",")}) VALUES (${["id", "uuid", ...columns].map(() => "?").join(",")});`,
		remove: `DELETE FROM ${table} WHERE uuid=?;`,
	}];
})) as Record<SyncEntity, { find: string; update: string; insert: string; remove: string }>;
export const removeChildren = {
	profile_calorie_history: 'DELETE FROM profile_calorie_history WHERE profile_id=?;',
	recipe_ingredients: "DELETE FROM recipe_ingredients WHERE recipe_id=?;",
	meal_log_profiles: "DELETE FROM meal_log_profiles WHERE meal_log_id=?;",
} as const;
