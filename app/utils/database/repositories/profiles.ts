import { lastInsertId, querySql, runSql } from "../sql";

export type Profile = {
	id: number;
	name: string;
	dailyCaloriesTarget: number;
	dailyProteinTarget: number | null;
	dailyCarbsTarget: number | null;
	dailyFatTarget: number | null;
	dailySugarTarget: number | null;
	dailyFiberTarget: number | null;
	dailySaltTarget: number | null;
	createdAt: string;
	updatedAt: string | null;
};

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

export type CreateProfileInput = {
	name: string;
	dailyCaloriesTarget: number;
	dailyProteinTarget?: number | null;
	dailyCarbsTarget?: number | null;
	dailyFatTarget?: number | null;
	dailySugarTarget?: number | null;
	dailyFiberTarget?: number | null;
	dailySaltTarget?: number | null;
};

export type UpdateProfileInput = Partial<CreateProfileInput>;

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

export async function listProfiles() {
	const rows = await querySql<ProfileRow>(`
    SELECT *
    FROM profiles
    ORDER BY created_at ASC, id ASC;
  `);

	return rows.map(mapProfile);
}

export async function getProfileById(id: number) {
	const rows = await querySql<ProfileRow>(
		"SELECT * FROM profiles WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapProfile(rows[0]) : null;
}

export async function createProfile(input: CreateProfileInput) {
	const result = await runSql(
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

export async function updateProfile(id: number, input: UpdateProfileInput) {
	const assignments: string[] = [];
	const values: Array<string | number | null> = [];

	if (input.name !== undefined) {
		assignments.push("name = ?");
		values.push(input.name.trim());
	}
	if (input.dailyCaloriesTarget !== undefined) {
		assignments.push("daily_calories_target = ?");
		values.push(input.dailyCaloriesTarget);
	}
	if (input.dailyProteinTarget !== undefined) {
		assignments.push("daily_protein_target = ?");
		values.push(input.dailyProteinTarget);
	}
	if (input.dailyCarbsTarget !== undefined) {
		assignments.push("daily_carbs_target = ?");
		values.push(input.dailyCarbsTarget);
	}
	if (input.dailyFatTarget !== undefined) {
		assignments.push("daily_fat_target = ?");
		values.push(input.dailyFatTarget);
	}
	if (input.dailySugarTarget !== undefined) {
		assignments.push("daily_sugar_target = ?");
		values.push(input.dailySugarTarget);
	}
	if (input.dailyFiberTarget !== undefined) {
		assignments.push("daily_fiber_target = ?");
		values.push(input.dailyFiberTarget);
	}
	if (input.dailySaltTarget !== undefined) {
		assignments.push("daily_salt_target = ?");
		values.push(input.dailySaltTarget);
	}

	if (assignments.length === 0) {
		return getProfileById(id);
	}

	assignments.push("updated_at = CURRENT_TIMESTAMP");
	values.push(id);

	await runSql(
		`UPDATE profiles SET ${assignments.join(", ")} WHERE id = ?;`,
		values,
	);
	return getProfileById(id);
}

export async function deleteProfile(id: number) {
	const result = await runSql("DELETE FROM profiles WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}
