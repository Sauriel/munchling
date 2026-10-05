// All SQL identifiers below are compile-time schema constants, never input.
const uuidSql = "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))";
const tables = [
	{ name: "profiles", columns: "name,daily_calories_target,daily_protein_target,daily_carbs_target,daily_fat_target,daily_sugar_target,daily_fiber_target,daily_salt_target,created_at,updated_at" },
	{ name: "foods", columns: "name_de,name_en,brand,ean,calories_per_100g,fat_per_100g,carbs_per_100g,sugar_per_100g,fiber_per_100g,protein_per_100g,salt_per_100g,is_custom,created_at,updated_at" },
	{ name: "recipes", columns: "name_de,name_en,description,is_sub_recipe,created_at,updated_at" },
	{ name: "recipe_ingredients", columns: "recipe_id,food_id,sub_recipe_id,amount_grams,created_at", parent: "recipes", parentId: "recipe_id" },
	{ name: "meal_logs", columns: "logged_at,food_id,recipe_id,total_weight_grams,created_at,updated_at" },
	{ name: "meal_log_profiles", columns: "meal_log_id,profile_id,portion_factor,created_at", parent: "meal_logs", parentId: "meal_log_id" },
] as const;

const core = `
CREATE TABLE sync_state (
 id INTEGER PRIMARY KEY CHECK (id = 1), device_id TEXT NOT NULL, local_epoch TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
 development_seeded INTEGER NOT NULL DEFAULT 0 CHECK (development_seeded IN (0,1)), server_url TEXT,
 server_instance_id TEXT, pull_cursor TEXT,
 tracking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (tracking_enabled IN (0,1)),
 CHECK (enabled=0 OR development_seeded=0)
);
INSERT INTO sync_state (id, device_id, local_epoch) VALUES (1, ${uuidSql}, ${uuidSql});
CREATE TABLE sync_records (
 uuid TEXT PRIMARY KEY, entity TEXT NOT NULL, local_id INTEGER,
 aggregate_entity TEXT NOT NULL, aggregate_uuid TEXT NOT NULL,
 local_revision INTEGER NOT NULL DEFAULT 1 CHECK (local_revision > 0),
 server_revision INTEGER NOT NULL DEFAULT 0 CHECK (server_revision >= 0), deleted_at TEXT,
 UNIQUE(entity, local_id)
);
CREATE INDEX idx_sync_records_aggregate ON sync_records(aggregate_uuid);
CREATE TABLE sync_dirty (entity TEXT NOT NULL, uuid TEXT PRIMARY KEY);
CREATE TABLE sync_outbox (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
 entity TEXT NOT NULL, entity_uuid TEXT NOT NULL, operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
 local_revision INTEGER NOT NULL, base_revision INTEGER NOT NULL CHECK (base_revision>=0), payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','inflight'))
);
CREATE INDEX idx_sync_outbox_batch ON sync_outbox(batch_id, sequence);
CREATE TABLE sync_baselines (uuid TEXT PRIMARY KEY, server_revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE sync_conflicts (uuid TEXT PRIMARY KEY, base_payload TEXT, local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL, server_revision INTEGER NOT NULL);
`;

function statements() {
	const result = [core];
	for (const table of tables) {
		result.push(`ALTER TABLE ${table.name} ADD COLUMN uuid TEXT;
UPDATE ${table.name} SET uuid = ${uuidSql};
CREATE UNIQUE INDEX idx_${table.name}_uuid ON ${table.name}(uuid);`);
	}
	// Parents have already received UUIDs before mapping any child aggregate.
	for (const table of tables) {
		const child = "parent" in table;
		const aggregate = child ? table.parent : table.name;
		const root = child ? `(SELECT uuid FROM ${table.parent} WHERE id = ${table.name}.${table.parentId})` : "uuid";
		result.push(`INSERT INTO sync_records (uuid,entity,local_id,aggregate_entity,aggregate_uuid)
SELECT uuid,'${table.name}',id,'${aggregate}',${root} FROM ${table.name};`);
	}
	result.push("INSERT INTO sync_dirty (entity,uuid) SELECT entity,uuid FROM sync_records WHERE uuid = aggregate_uuid;");
	for (const table of tables) {
		const child = "parent" in table;
		const aggregate = child ? table.parent : table.name;
		const newRoot = child ? `(SELECT uuid FROM ${table.parent} WHERE id = NEW.${table.parentId})` : `(SELECT uuid FROM ${table.name} WHERE id = NEW.id)`;
		// The registry retains the aggregate UUID even after the physical parent
		// has been removed by SQLite's FK cascade (no lookup of a deleted parent).
		const mark = (row: "NEW" | "OLD") => `
INSERT OR IGNORE INTO sync_dirty (entity,uuid)
 SELECT aggregate_entity,aggregate_uuid FROM sync_records WHERE uuid = ${row}.uuid AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
${child ? `UPDATE sync_records SET local_revision=local_revision+1 WHERE uuid=(SELECT aggregate_uuid FROM sync_records WHERE uuid=${row}.uuid) AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;` : ""}`;
		result.push(`
CREATE TRIGGER sync_${table.name}_uuid_immutable BEFORE UPDATE OF uuid ON ${table.name}
WHEN OLD.uuid IS NOT NULL AND NEW.uuid IS NOT OLD.uuid
BEGIN SELECT RAISE(ABORT,'UUID is immutable'); END;
CREATE TRIGGER sync_${table.name}_insert AFTER INSERT ON ${table.name}
BEGIN
 UPDATE ${table.name} SET uuid=COALESCE(NEW.uuid,${uuidSql}) WHERE id=NEW.id;
 INSERT INTO sync_records (uuid,entity,local_id,aggregate_entity,aggregate_uuid)
 SELECT uuid,'${table.name}',id,'${aggregate}',${newRoot} FROM ${table.name} WHERE id=NEW.id;
 INSERT OR IGNORE INTO sync_dirty (entity,uuid)
 SELECT aggregate_entity,aggregate_uuid FROM sync_records WHERE entity='${table.name}' AND local_id=NEW.id AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
 ${child ? `UPDATE sync_records SET local_revision=local_revision+1 WHERE uuid=${newRoot} AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;` : ""}
END;
CREATE TRIGGER sync_${table.name}_update AFTER UPDATE OF ${table.columns} ON ${table.name}
BEGIN
 ${mark("OLD")}
 UPDATE sync_records SET aggregate_uuid=${newRoot}, deleted_at=NULL,
 local_revision=local_revision + (SELECT tracking_enabled FROM sync_state WHERE id=1)
 WHERE uuid=NEW.uuid;
 ${mark("NEW")}
END;
CREATE TRIGGER sync_${table.name}_delete AFTER DELETE ON ${table.name}
BEGIN
 UPDATE sync_records SET deleted_at=CURRENT_TIMESTAMP,
 local_revision=local_revision + (SELECT tracking_enabled FROM sync_state WHERE id=1) WHERE uuid=OLD.uuid;
 ${mark("OLD")}
END;`);
	}
	return result.join("\n");
}

export const syncSchemaStatements = statements();
