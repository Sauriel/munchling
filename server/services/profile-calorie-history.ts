import { verifyProfileCalorieWrite,type ProfileCalorieWireRow } from '../../shared/domain/profile-calorie-wire'
import { ServerWriteError } from '../../shared/domain/server'
import type { ServerSql } from '../database/connection'
import { utcTimestamp,sqlTimestamp } from './validation'

/** Immutable profile-child storage used by the guarded production batch.
 * Caller must hold the household write lock and profile optimistic guard. */
export async function readServerProfileCalorieHistory(sql: ServerSql,profileId: string): Promise<ProfileCalorieWireRow[]> {
  const rows = await sql.query<Record<string,unknown>>('SELECT uuid,profile_id,`sequence`,valid_from,created_at,event_json FROM profile_calorie_history WHERE profile_id=? AND deleted_at IS NULL ORDER BY `sequence`',[profileId])
  return rows.map(row => ({ id: String(row.uuid),profile_id: String(row.profile_id),sequence: Number(row.sequence),valid_from: String(row.valid_from),created_at: utcTimestamp(row.created_at,'created_at'),event_json: String(row.event_json) }))
}
export async function appendServerProfileCalorieHistory(sql: ServerSql,profileId: string,rows: ProfileCalorieWireRow[],previousManualTargetKcal: number,nextManualTargetKcal: number) {
  const previous = await readServerProfileCalorieHistory(sql,profileId)
  verifyProfileCalorieWrite(previous,rows,profileId,previousManualTargetKcal,nextManualTargetKcal)
  const known = new Set(previous.map(row => row.id))
  for (const row of rows) {
    if (known.has(row.id)) continue // Do NOT bump/replace an accepted child.
    const identities = await sql.query<{ entity: string; aggregate_uuid: string }>('SELECT entity,aggregate_uuid FROM sync_identities WHERE uuid=?',[row.id])
    // No tombstone resurrection or claiming another profile's UUID.
    if (identities.length) throw new ServerWriteError('identityConflict')
    await sql.write("INSERT INTO sync_identities(uuid,entity,aggregate_uuid,version) VALUES(?,'profile_calorie_history',?,1)",[row.id,profileId])
    await sql.write('INSERT INTO profile_calorie_history(uuid,profile_id,`sequence`,valid_from,created_at,event_json) VALUES(?,?,?,?,?,?)',
      [row.id,profileId,row.sequence,row.valid_from,sqlTimestamp(row.created_at),row.event_json])
  }
}
/** Used only for an explicitly allowed whole-profile deletion, never when
 * replacing an active profile or removing entries from an uploaded array. */
export async function tombstoneServerProfileCalorieHistory(sql: ServerSql,profileId: string,timestamp: string) {
  const created = sqlTimestamp(timestamp)
  await sql.write('UPDATE sync_identities i JOIN profile_calorie_history h ON h.uuid=i.uuid SET i.deleted_at=?,i.version=i.version+1 WHERE h.profile_id=? AND h.deleted_at IS NULL',[created,profileId])
  await sql.write('UPDATE profile_calorie_history SET deleted_at=? WHERE profile_id=? AND deleted_at IS NULL',[created,profileId])
}
