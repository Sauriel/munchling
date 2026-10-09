// This manifest contains ONLY compile-time identifiers/SQL. Imported payloads
// are always bound values; they never supply table or column identifiers.
const legacyServerTables = {
	profiles: { columns: ["name", "daily_calories_target", "daily_protein_target", "daily_carbs_target", "daily_fat_target", "daily_sugar_target", "daily_fiber_target", "daily_salt_target", "created_at", "updated_at"], definitions: `
name LONGTEXT NOT NULL, daily_calories_target BIGINT NOT NULL CHECK (daily_calories_target BETWEEN 0 AND 9007199254740991),
daily_protein_target DOUBLE CHECK (daily_protein_target>=0), daily_carbs_target DOUBLE CHECK (daily_carbs_target>=0),
daily_fat_target DOUBLE CHECK (daily_fat_target>=0), daily_sugar_target DOUBLE CHECK (daily_sugar_target>=0),
daily_fiber_target DOUBLE CHECK (daily_fiber_target>=0), daily_salt_target DOUBLE CHECK (daily_salt_target>=0)` },
	foods: { columns: ["name_de", "name_en", "brand", "ean", "calories_per_100g", "fat_per_100g", "carbs_per_100g", "sugar_per_100g", "fiber_per_100g", "protein_per_100g", "salt_per_100g", "is_custom", "portion_size_grams", "created_at", "updated_at"], definitions: `
name_de LONGTEXT NOT NULL, name_en LONGTEXT NOT NULL, brand LONGTEXT,
ean VARCHAR(255) COLLATE utf8mb4_bin,
active_ean VARCHAR(255) COLLATE utf8mb4_bin GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN ean ELSE NULL END) PERSISTENT,
UNIQUE KEY uq_active_ean(active_ean),
calories_per_100g DOUBLE NOT NULL CHECK (calories_per_100g>=0), fat_per_100g DOUBLE NOT NULL CHECK (fat_per_100g>=0),
carbs_per_100g DOUBLE NOT NULL CHECK (carbs_per_100g>=0), sugar_per_100g DOUBLE NOT NULL CHECK (sugar_per_100g>=0),
fiber_per_100g DOUBLE NOT NULL CHECK (fiber_per_100g>=0), protein_per_100g DOUBLE NOT NULL CHECK (protein_per_100g>=0),
salt_per_100g DOUBLE NOT NULL CHECK (salt_per_100g>=0), is_custom TINYINT NOT NULL CHECK (is_custom IN (0,1))` },
	recipes: { columns: ["name_de", "name_en", "description", "is_sub_recipe", "portion_size_grams", "created_at", "updated_at"], definitions: `
name_de LONGTEXT NOT NULL, name_en LONGTEXT NOT NULL, description LONGTEXT,
is_sub_recipe TINYINT NOT NULL CHECK (is_sub_recipe IN (0,1))` },
	meal_logs: { columns: ["logged_at", "food_id", "recipe_id", "total_weight_grams", "created_at", "updated_at"], definitions: `
logged_at VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, food_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
recipe_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, total_weight_grams DOUBLE NOT NULL CHECK (total_weight_grams>0),
CHECK ((food_id IS NULL) <> (recipe_id IS NULL)),
FOREIGN KEY(food_id) REFERENCES foods(uuid), FOREIGN KEY(recipe_id) REFERENCES recipes(uuid), KEY idx_logged_at(logged_at)` },
	recipe_ingredients: { columns: ["recipe_id", "food_id", "sub_recipe_id", "amount_grams", "created_at"], definitions: `
recipe_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
food_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, sub_recipe_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
amount_grams DOUBLE NOT NULL CHECK (amount_grams>0), CHECK ((food_id IS NULL) <> (sub_recipe_id IS NULL)),
FOREIGN KEY(recipe_id) REFERENCES recipes(uuid), FOREIGN KEY(food_id) REFERENCES foods(uuid), FOREIGN KEY(sub_recipe_id) REFERENCES recipes(uuid)` },
	meal_log_profiles: { columns: ["meal_log_id", "profile_id", "portion_factor", "created_at"], definitions: `
meal_log_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
portion_factor DOUBLE NOT NULL CHECK (portion_factor>0), FOREIGN KEY(meal_log_id) REFERENCES meal_logs(uuid), FOREIGN KEY(profile_id) REFERENCES profiles(uuid),
active_flag TINYINT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) PERSISTENT,
UNIQUE KEY uq_active_portion(meal_log_id,profile_id,active_flag)` },
} as const;
const activityTables = {
	activities: { columns: ['name', 'duration_minutes', 'calories', 'created_at', 'updated_at'], definitions: `name LONGTEXT NOT NULL, duration_minutes DOUBLE NOT NULL CHECK(duration_minutes>0), calories DOUBLE NOT NULL CHECK(calories>=0)` },
	activity_logs: { columns: ['profile_id', 'date', 'name', 'duration_minutes', 'calories', 'units', 'created_at', 'updated_at'], definitions: `profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, date CHAR(10) CHARACTER SET ascii NOT NULL, name LONGTEXT NOT NULL, duration_minutes DOUBLE NOT NULL CHECK(duration_minutes>0), calories DOUBLE NOT NULL CHECK(calories>=0), units DOUBLE NOT NULL CHECK(units>0), FOREIGN KEY(profile_id) REFERENCES profiles(uuid), KEY idx_activity_profile_date(profile_id,date)` },
} as const;
export const serverTables = { ...legacyServerTables, ...activityTables };
export type ServerTable = keyof typeof serverTables;
export const migrationTableSql = `CREATE TABLE IF NOT EXISTS schema_migrations (
 version INT PRIMARY KEY, name VARCHAR(128) NOT NULL, checksum CHAR(64) CHARACTER SET ascii NOT NULL,
 status ENUM('applying','applied') NOT NULL, applied_at DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

const initialStatements = [
	`CREATE TABLE server_state (id TINYINT PRIMARY KEY CHECK (id=1), instance_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 epoch_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, last_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0 CHECK (last_cursor<=9007199254740991)) ENGINE=InnoDB`,
	`CREATE TABLE sync_identities (uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 entity ENUM('profiles','foods','recipes','recipe_ingredients','meal_logs','meal_log_profiles') NOT NULL,
 aggregate_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 0 CHECK (version<=9007199254740991), deleted_at DATETIME(3), KEY idx_aggregate(aggregate_uuid)) ENGINE=InnoDB`,
	...Object.entries(legacyServerTables).map(([name, table]) => `CREATE TABLE ${name} (
 view_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
 uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 created_at DATETIME(3) NOT NULL${(table.columns as readonly string[]).includes("updated_at") ? ", updated_at DATETIME(3)" : ""}, deleted_at DATETIME(3),
 ${table.definitions}, FOREIGN KEY(uuid) REFERENCES sync_identities(uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`),
	`CREATE TABLE sync_devices (uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 first_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_ack_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0 CHECK (last_ack_cursor<=9007199254740991)) ENGINE=InnoDB`,
	`CREATE TABLE write_batches (uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 device_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 receipt_json LONGTEXT NOT NULL CHECK (JSON_VALID(receipt_json)), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(device_uuid) REFERENCES sync_devices(uuid)) ENGINE=InnoDB`,
	`CREATE TABLE write_operations (uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 batch_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, entity VARCHAR(32) NOT NULL,
 entity_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, base_revision BIGINT UNSIGNED NOT NULL,
 server_revision BIGINT UNSIGNED NOT NULL, FOREIGN KEY(batch_uuid) REFERENCES write_batches(uuid)) ENGINE=InnoDB`,
	`CREATE TABLE change_log (change_cursor BIGINT UNSIGNED PRIMARY KEY CHECK (change_cursor<=9007199254740991),
 batch_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, entity VARCHAR(32) NOT NULL,
 entity_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, version BIGINT UNSIGNED NOT NULL,
 payload LONGTEXT NOT NULL CHECK (JSON_VALID(payload)), committed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_change_batch(batch_uuid), FOREIGN KEY(batch_uuid) REFERENCES write_batches(uuid)) ENGINE=InnoDB`,
].map((statement) => statement.replace(/ENGINE=InnoDB$/, "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"));
// v1 remains byte-for-byte unchanged. Snapshot storage is a new migration.
const snapshotStatements = [
	`CREATE TABLE sync_snapshot_lock (id TINYINT PRIMARY KEY CHECK(id=1)) ENGINE=InnoDB`,
	`INSERT INTO sync_snapshot_lock(id) VALUES (1)`,
	`CREATE TABLE sync_snapshots (uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 instance_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, epoch_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 change_cursor BIGINT UNSIGNED NOT NULL CHECK(change_cursor<=9007199254740991), page_count INT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME(3) NOT NULL, KEY idx_snapshot_expiry(expires_at)) ENGINE=InnoDB`,
	`CREATE TABLE sync_snapshot_pages (snapshot_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 page_index INT UNSIGNED NOT NULL, payload LONGTEXT NOT NULL CHECK(JSON_VALID(payload)),
 PRIMARY KEY(snapshot_uuid,page_index), FOREIGN KEY(snapshot_uuid) REFERENCES sync_snapshots(uuid) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
];
export const serverMigrations = [
	{ version: 1, name: "household_data_and_versioned_changes", statements: initialStatements },
	{ version: 2, name: "durable_consistent_download_snapshots", statements: snapshotStatements },
	{ version: 3, name: "food_and_recipe_portion_sizes", statements: [
		"ALTER TABLE foods ADD COLUMN portion_size_grams DOUBLE NULL CHECK(portion_size_grams IS NULL OR portion_size_grams > 0)",
		"ALTER TABLE recipes ADD COLUMN portion_size_grams DOUBLE NULL CHECK(portion_size_grams IS NULL OR portion_size_grams > 0)",
	] },
	{ version: 4, name: 'activities_and_daily_activity_logs', statements: [
		"ALTER TABLE sync_identities MODIFY entity ENUM('profiles','foods','recipes','recipe_ingredients','meal_logs','meal_log_profiles','activities','activity_logs') NOT NULL",
		...Object.entries(activityTables).map(([name, table]) => `CREATE TABLE ${name} (view_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE, uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3), deleted_at DATETIME(3), ${table.definitions}, FOREIGN KEY(uuid) REFERENCES sync_identities(uuid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`),
	] },
];

export const tableStatements = Object.fromEntries(Object.entries(serverTables).map(([name, table]) => [name, {
	select: `SELECT * FROM ${name} WHERE uuid=?`,
	insert: `INSERT INTO ${name} (uuid,${table.columns.join(",")},deleted_at) VALUES (${["uuid", ...table.columns, "deleted_at"].map(() => "?").join(",")})`,
	update: `UPDATE ${name} SET ${[...table.columns, "deleted_at"].map((column) => `${column}=?`).join(",")} WHERE uuid=?`,
	remove: `UPDATE ${name} SET deleted_at=? WHERE uuid=?`,
}])) as Record<ServerTable, { select: string; insert: string; update: string; remove: string }>;
