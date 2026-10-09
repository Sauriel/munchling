import type { Activity, ActivityInput, ActivityLog, ActivityLogInput } from '../../../../shared/domain/activities'
import { activityTotals, validateActivity, validateActivityLog } from '../../../../shared/domain/activities'
import { SyncClientError } from '../../../../shared/domain/replies'
import { assertId, fail } from '../../../../shared/domain/validation'
import { lastInsertId, type SqlDatabase, type SqlExecutor } from '../executor'

type Row = Record<string, unknown>
const base = (r: Row): Activity => ({ id: Number(r.id), ...(r.revision != null ? { revision: Number(r.revision) } : {}), name: String(r.name), durationMinutes: Number(r.duration_minutes), calories: Number(r.calories), createdAt: String(r.created_at), updatedAt: r.updated_at as string | null })
const log = (r: Row): ActivityLog => ({ ...base(r), profileId: Number(r.profile_id), date: String(r.date), units: Number(r.units) })
export function createActivitiesRepository(db: SqlDatabase) {
  const getActivityById = async (id: number, sql: SqlExecutor = db) => { const r = (await sql.query('SELECT a.*,(s.local_revision+s.server_revision) AS revision FROM activities a JOIN sync_records s ON s.uuid=a.uuid WHERE a.id=?;', [id]))[0]; return r ? base(r) : null }
  return {
    listActivities: async () => (await db.query('SELECT a.*,(s.local_revision+s.server_revision) AS revision FROM activities a JOIN sync_records s ON s.uuid=a.uuid ORDER BY a.name COLLATE NOCASE,a.id;')).map(base), getActivityById,
    createActivity: async (input: ActivityInput) => {
      validateActivity(input)
      return db.transaction(async sql => { const r = await sql.run('INSERT INTO activities(name,duration_minutes,calories) VALUES(?,?,?);', [input.name.trim(), input.durationMinutes, input.calories]); return getActivityById(lastInsertId(r), sql) })
    },
    updateActivity: async (id: number, input: ActivityInput, revision?: number) => {
      assertId(id); validateActivity(input)
      return db.transaction(async sql => { const old = await getActivityById(id,sql); if (revision !== undefined && revision !== old?.revision) throw new SyncClientError('versionConflict'); await sql.run('UPDATE activities SET name=?,duration_minutes=?,calories=?,updated_at=CURRENT_TIMESTAMP WHERE id=?;', [input.name.trim(), input.durationMinutes, input.calories, id]); return getActivityById(id, sql) })
    },
    deleteActivity: async (id: number, revision?: number) => { assertId(id); return db.transaction(async sql => { const old = await getActivityById(id,sql); if (revision !== undefined && revision !== old?.revision) throw new SyncClientError('versionConflict'); return (await sql.run('DELETE FROM activities WHERE id=?;', [id])).changes?.changes ?? 0 }) },
  }
}
export function createActivityLogsRepository(db: SqlDatabase) {
  return {
    listActivityLogs: async () => (await db.query('SELECT * FROM activity_logs ORDER BY date DESC,id DESC;')).map(log),
    createActivityLogs: async (input: ActivityLogInput) => {
      validateActivityLog(input)
      return db.transaction(async sql => {
        const activity = await createActivitiesRepository(db).getActivityById(input.activityId, sql)
        if (!activity) fail('reference', 'activityId')
        if (input.activityRevision !== undefined && input.activityRevision !== activity.revision) throw new SyncClientError('versionConflict')
        const results: ActivityLog[] = []
        for (const row of input.profiles) {
          activityTotals(activity, row.units)
          if (!(await sql.query('SELECT id FROM profiles WHERE id=?;', [row.profileId])).length) fail('reference', 'profileId')
          const result = await sql.run('INSERT INTO activity_logs(profile_id,date,name,duration_minutes,calories,units) VALUES(?,?,?,?,?,?);', [row.profileId, input.date, activity.name, activity.durationMinutes, activity.calories, row.units])
          results.push(log((await sql.query('SELECT * FROM activity_logs WHERE id=?;', [lastInsertId(result)]))[0]!))
        }
        return results
      })
    },
    deleteActivityLog: async (id: number) => { assertId(id); return (await db.run('DELETE FROM activity_logs WHERE id=?;', [id])).changes?.changes ?? 0 },
  }
}
