// SQLite9 profile child history. Registered alongside backup5, schema5 wire,
// guarded server writes and append-only receive compatibility.
export const profileCalorieSchemaStatements = `
CREATE TABLE profile_calorie_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
 profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence>0), valid_from TEXT NOT NULL,
 created_at TEXT NOT NULL, event_json TEXT NOT NULL,
 UNIQUE(profile_id,sequence)
);
CREATE INDEX idx_profile_calorie_history_date ON profile_calorie_history(profile_id,valid_from);
CREATE TRIGGER profile_calorie_history_immutable BEFORE UPDATE ON profile_calorie_history
WHEN NEW.uuid IS NOT OLD.uuid OR NEW.profile_id IS NOT OLD.profile_id OR NEW.sequence IS NOT OLD.sequence
 OR NEW.valid_from IS NOT OLD.valid_from OR NEW.created_at IS NOT OLD.created_at OR NEW.event_json IS NOT OLD.event_json
BEGIN SELECT RAISE(ABORT,'Calorie history is immutable'); END;
CREATE TRIGGER profile_calorie_history_no_individual_delete BEFORE DELETE ON profile_calorie_history
WHEN EXISTS(SELECT 1 FROM profiles WHERE id=OLD.profile_id) AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1
BEGIN SELECT RAISE(ABORT,'Calorie history is immutable'); END;
CREATE TRIGGER sync_profile_calorie_history_insert AFTER INSERT ON profile_calorie_history BEGIN
 INSERT INTO sync_records(uuid,entity,local_id,aggregate_entity,aggregate_uuid)
 SELECT NEW.uuid,'profile_calorie_history',NEW.id,'profiles',uuid FROM profiles WHERE id=NEW.profile_id;
 UPDATE sync_records SET local_revision=local_revision+1
 WHERE uuid=(SELECT uuid FROM profiles WHERE id=NEW.profile_id) AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
 INSERT OR IGNORE INTO sync_dirty(entity,uuid)
 SELECT 'profiles',uuid FROM profiles WHERE id=NEW.profile_id AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
END;
CREATE TRIGGER sync_profile_calorie_history_delete AFTER DELETE ON profile_calorie_history BEGIN
 UPDATE sync_records SET deleted_at=CURRENT_TIMESTAMP,local_revision=local_revision+(SELECT tracking_enabled FROM sync_state WHERE id=1) WHERE uuid=OLD.uuid;
 INSERT OR IGNORE INTO sync_dirty(entity,uuid)
 SELECT aggregate_entity,aggregate_uuid FROM sync_records WHERE uuid=OLD.uuid AND (SELECT tracking_enabled FROM sync_state WHERE id=1)=1;
END;
`;
