import { databaseSql } from "../sql";
import { lastInsertId, type SqlDatabase } from "../executor";
import type { Profile, CreateProfileInput, UpdateProfileInput } from "../../../../shared/domain/types";
export type { Profile, CreateProfileInput, UpdateProfileInput } from "../../../../shared/domain/types";

type ProfileRow = {
	id: number;
	name: string;
	daily_calories_target: number;
	daily_protein_target: number | null;
	daily_carbs_target: number | null;
	daily_fat_target: number | null;
	daily_sugar_target: number | null;
	daily_fiber_target: number | null;
	daily_salt_target: number | null;
	created_at: string;
	updated_at: string | null;
};

function mapProfile(row: ProfileRow): Profile {
	return {
		id: row.id,
		name: row.name,
		dailyCaloriesTarget: row.daily_calories_target,
		dailyProteinTarget: row.daily_protein_target,
		dailyCarbsTarget: row.daily_carbs_target,
		dailyFatTarget: row.daily_fat_target,
		dailySugarTarget: row.daily_sugar_target,
		dailyFiberTarget: row.daily_fiber_target,
		dailySaltTarget: row.daily_salt_target,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function createProfilesRepository(database: SqlDatabase) {
async function listProfiles() {
	const rows = await database.query<ProfileRow>(`
    SELECT *
    FROM profiles
    ORDER BY created_at ASC, id ASC;
  `);

	return rows.map(mapProfile);
}

async function getProfileById(id: number) {
	const rows = await database.query<ProfileRow>(
		"SELECT * FROM profiles WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapProfile(rows[0]) : null;
}

async function createProfile(input: CreateProfileInput) {
	const result = await database.run(
		`
      INSERT INTO profiles (
        name,
        daily_calories_target,
        daily_protein_target,
        daily_carbs_target,
        daily_fat_target,
        daily_sugar_target,
        daily_fiber_target,
        daily_salt_target
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `,
		[
			input.name.trim(),
			input.dailyCaloriesTarget,
			input.dailyProteinTarget ?? null,
			input.dailyCarbsTarget ?? null,
			input.dailyFatTarget ?? null,
			input.dailySugarTarget ?? null,
			input.dailyFiberTarget ?? null,
			input.dailySaltTarget ?? null,
		],
	);

	return getProfileById(lastInsertId(result));
}

async function updateProfile(id: number, input: UpdateProfileInput) {
	if (!Object.values(input).some((value) => value !== undefined)) return getProfileById(id);
	await database.run(
		`UPDATE profiles SET
		 name = CASE WHEN ? THEN ? ELSE name END,
		 daily_calories_target = CASE WHEN ? THEN ? ELSE daily_calories_target END,
		 daily_protein_target = CASE WHEN ? THEN ? ELSE daily_protein_target END,
		 daily_carbs_target = CASE WHEN ? THEN ? ELSE daily_carbs_target END,
		 daily_fat_target = CASE WHEN ? THEN ? ELSE daily_fat_target END,
		 daily_sugar_target = CASE WHEN ? THEN ? ELSE daily_sugar_target END,
		 daily_fiber_target = CASE WHEN ? THEN ? ELSE daily_fiber_target END,
		 daily_salt_target = CASE WHEN ? THEN ? ELSE daily_salt_target END,
		 updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
		[
			input.name !== undefined, input.name?.trim() ?? null,
			input.dailyCaloriesTarget !== undefined, input.dailyCaloriesTarget ?? null,
			input.dailyProteinTarget !== undefined, input.dailyProteinTarget ?? null,
			input.dailyCarbsTarget !== undefined, input.dailyCarbsTarget ?? null,
			input.dailyFatTarget !== undefined, input.dailyFatTarget ?? null,
			input.dailySugarTarget !== undefined, input.dailySugarTarget ?? null,
			input.dailyFiberTarget !== undefined, input.dailyFiberTarget ?? null,
			input.dailySaltTarget !== undefined, input.dailySaltTarget ?? null, id,
		],
	);
	return getProfileById(id);
}

async function deleteProfile(id: number) {
	const result = await database.run("DELETE FROM profiles WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}

return { listProfiles, getProfileById, createProfile, updateProfile, deleteProfile };
}

export const { listProfiles, getProfileById, createProfile, updateProfile, deleteProfile } = createProfilesRepository(databaseSql);
