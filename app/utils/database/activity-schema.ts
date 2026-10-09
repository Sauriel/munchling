const uuidSql = "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))";
// New root tables only. Never modify published v2 trigger text.
function tracking(table: 'activities' | 'activity_logs') {
  const dirty = (row: 'NEW' | 'OLD') => `INSERT OR IGNORE INTO sync_dirty(entity,uuid) SELECT '${table}',${row}.uuid WHERE (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;`
  return `
CREATE TRIGGER sync_${table}_uuid_immutable BEFORE UPDATE OF uuid ON ${table}
WHEN OLD.uuid IS NOT NULL AND NEW.uuid IS NOT OLD.uuid BEGIN SELECT RAISE(ABORT,'UUID is immutable'); END;
CREATE TRIGGER sync_${table}_insert AFTER INSERT ON ${table} BEGIN
 UPDATE ${table} SET uuid=COALESCE(NEW.uuid,${uuidSql}) WHERE id=NEW.id;
 INSERT INTO sync_records(uuid,entity,local_id,aggregate_entity,aggregate_uuid) SELECT uuid,'${table}',id,'${table}',uuid FROM ${table} WHERE id=NEW.id;
 INSERT OR IGNORE INTO sync_dirty(entity,uuid) SELECT '${table}',uuid FROM ${table} WHERE id=NEW.id AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
END;
CREATE TRIGGER sync_${table}_update AFTER UPDATE OF name,duration_minutes,calories,created_at,updated_at${table === 'activity_logs' ? ',profile_id,date,units' : ''} ON ${table} BEGIN
 UPDATE sync_records SET local_revision=local_revision+(SELECT tracking_enabled FROM sync_state WHERE id=1),deleted_at=NULL WHERE uuid=NEW.uuid;
 ${dirty('NEW')}
END;
CREATE TRIGGER sync_${table}_delete AFTER DELETE ON ${table} BEGIN
 UPDATE sync_records SET deleted_at=CURRENT_TIMESTAMP,local_revision=local_revision+(SELECT tracking_enabled FROM sync_state WHERE id=1) WHERE uuid=OLD.uuid;
 ${dirty('OLD')}
END;`
}
export const activitySchemaStatements = `
CREATE TABLE activities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, name TEXT NOT NULL,
 duration_minutes REAL NOT NULL CHECK(duration_minutes>0), calories REAL NOT NULL CHECK(calories>=0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
);
CREATE TABLE activity_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 date TEXT NOT NULL, name TEXT NOT NULL, duration_minutes REAL NOT NULL CHECK(duration_minutes>0),
 calories REAL NOT NULL CHECK(calories>=0), units REAL NOT NULL CHECK(units>0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
);
CREATE INDEX idx_activity_logs_profile_date ON activity_logs(profile_id,date);
${tracking('activities')}
${tracking('activity_logs')}
`;
