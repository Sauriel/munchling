import { assertId,fail } from '../../../../shared/domain/validation'
import type { ProfileCalorieEvent,CalorieHistoryContext } from '../../../../shared/domain/profile-calorie-history'
import { decodeProfileCalorieRows,encodeProfileCalorieEvent,verifyProfileCalorieWrite,type ProfileCalorieWireRow } from '../../../../shared/domain/profile-calorie-wire'
import type { SqlExecutor } from '../executor'

type HistoryRow = { parent_uuid: string; manual_target: number; uuid: string | null; sequence: number; valid_from: string; created_at: string; event_json: string }
async function readContextWithRows(sql: SqlExecutor,profileId: number,today: string) {
  assertId(profileId)
  const rows = await sql.query<HistoryRow>(`SELECT p.uuid AS parent_uuid,p.daily_calories_target AS manual_target,
    h.uuid,h.sequence,h.valid_from,h.created_at,h.event_json FROM profiles p
    LEFT JOIN profile_calorie_history h ON h.profile_id=p.id WHERE p.id=? ORDER BY h.sequence;`,[profileId])
  const parent = rows[0]; if (!parent) fail('reference','profileId')
  const wire: ProfileCalorieWireRow[] = rows.filter(row => row.uuid !== null).map(row => ({ id: row.uuid!,profile_id: parent.parent_uuid,sequence: row.sequence,valid_from: row.valid_from,created_at: row.created_at,event_json: row.event_json }))
  const history = decodeProfileCalorieRows(wire,parent.parent_uuid)
  return { wire,context: { profileId: parent.parent_uuid,today,manualTargetKcal: parent.manual_target,history } satisfies CalorieHistoryContext }
}
/** Scoped functions only: the calling profile command owns the transaction,
 * including its complete outbox payload. Candidate schema is not active yet. */
export async function readProfileCalorieContext(sql: SqlExecutor,profileId: number,today: string): Promise<CalorieHistoryContext> {
  return (await readContextWithRows(sql,profileId,today)).context
}
export async function appendProfileCalorieEvent(sql: SqlExecutor,profileId: number,event: ProfileCalorieEvent) {
  const { wire,context } = await readContextWithRows(sql,profileId,event.validFrom), row = encodeProfileCalorieEvent(event)
  verifyProfileCalorieWrite(wire,[...wire,row],context.profileId,context.manualTargetKcal,event.state.manualTargetKcal)
  // Preserve the independently editable legacy manual target even in auto mode.
  await sql.run('UPDATE profiles SET daily_calories_target=?,updated_at=? WHERE id=?;', [event.state.manualTargetKcal,event.createdAt,profileId])
  await sql.run(`INSERT INTO profile_calorie_history(uuid,profile_id,sequence,valid_from,created_at,event_json) VALUES(?,?,?,?,?,?);`,
    [row.id,profileId,row.sequence,row.valid_from,row.created_at,row.event_json])
  return structuredClone(event)
}
