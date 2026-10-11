// MariaDB5 profile child history. Registered with schema5 client capability,
// original receipt replay, guarded writes, backups and append-only receive.
export const serverProfileCalorieStatements = [
  "ALTER TABLE sync_identities MODIFY entity ENUM('profiles','foods','recipes','recipe_ingredients','meal_logs','meal_log_profiles','activities','activity_logs','profile_calorie_history') NOT NULL",
  `CREATE TABLE profile_calorie_history (
    view_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
    uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    \`sequence\` BIGINT UNSIGNED NOT NULL CHECK(\`sequence\` BETWEEN 1 AND 9007199254740991),
    valid_from CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL, deleted_at DATETIME(3),
    event_json LONGTEXT NOT NULL CHECK(JSON_VALID(event_json)),
    UNIQUE KEY uq_profile_calorie_sequence(profile_id,\`sequence\`),
    KEY idx_profile_calorie_date(profile_id,valid_from),
    FOREIGN KEY(uuid) REFERENCES sync_identities(uuid), FOREIGN KEY(profile_id) REFERENCES profiles(uuid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
] as const
