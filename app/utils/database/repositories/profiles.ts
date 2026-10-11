import { databaseSql } from '../sql'
import { assertId,fail,validateProfileInput } from '../../../../shared/domain/validation'
import { planProfileCalorieEvents,localCalendarDate } from '../../../../shared/domain/profile-calorie-command'
import { appendProfileCalorieEvent,readProfileCalorieContext } from './profile-calorie-history'
import { lastInsertId,type SqlDatabase,type SqlExecutor } from '../executor'
import type { Profile,CreateProfileInput,UpdateProfileInput } from '../../../../shared/domain/types'
export type { Profile,CreateProfileInput,UpdateProfileInput } from '../../../../shared/domain/types'
type ProfileRow = { id: number; uuid?: string; name: string; daily_calories_target: number; daily_protein_target: number | null; daily_carbs_target: number | null; daily_fat_target: number | null; daily_sugar_target: number | null; daily_fiber_target: number | null; daily_salt_target: number | null; created_at: string; updated_at: string | null }
async function mapProfile(sql: SqlExecutor,row: ProfileRow): Promise<Profile> {
  const available = (await sql.query("SELECT name FROM sqlite_master WHERE name='profile_calorie_history';")).length > 0
  return { id: row.id,...(row.uuid ? { uuid: row.uuid } : {}),...(available ? { calorieHistory: [...(await readProfileCalorieContext(sql,row.id,localCalendarDate())).history] } : {}),name: row.name,dailyCaloriesTarget: row.daily_calories_target,dailyProteinTarget: row.daily_protein_target,dailyCarbsTarget: row.daily_carbs_target,dailyFatTarget: row.daily_fat_target,dailySugarTarget: row.daily_sugar_target,dailyFiberTarget: row.daily_fiber_target,dailySaltTarget: row.daily_salt_target,createdAt: row.created_at,updatedAt: row.updated_at }
}
async function get(sql: SqlExecutor,id: number) {
  const row = (await sql.query<ProfileRow>('SELECT * FROM profiles WHERE id=? LIMIT 1;',[id]))[0]
  return row ? mapProfile(sql,row) : null
}
async function history(sql: SqlExecutor,id: number,input: UpdateProfileInput,initialize = false) {
  if (!(await sql.query("SELECT name FROM sqlite_master WHERE name='profile_calorie_history';")).length) {
    if (input.calorieChange) fail('reference','calorieHistory')
    return
  }
  if (input.calorieChange && !input.calorieDate) fail('required','calorieDate')
  const date = input.calorieDate ?? localCalendarDate(), context = await readProfileCalorieContext(sql,id,date)
  const nextManual = input.dailyCaloriesTarget ?? context.manualTargetKcal
  if (nextManual === 0 && !context.history.length && !input.calorieChange) return // Legacy zero placeholder.
  const events = planProfileCalorieEvents(context.profileId,context.history,context.manualTargetKcal,nextManual,date,input.calorieChange,initialize)
  for (const event of events) await appendProfileCalorieEvent(sql,id,event)
}
export function createProfilesRepository(database: SqlDatabase) {
  const listProfiles = () => database.transaction(async sql => {
    const rows = await sql.query<ProfileRow>('SELECT * FROM profiles ORDER BY created_at ASC,id ASC;')
    return Promise.all(rows.map(row => mapProfile(sql,row)))
  })
  const getProfileById = (id: number) => database.transaction(sql => get(sql,id))
  async function createProfile(input: CreateProfileInput) {
    validateProfileInput(input)
    if (input.dailyCaloriesTarget <= 0) fail('invalidNumber','dailyCaloriesTarget')
    if (input.calorieChange) fail('reference','saveProfileFirst')
    return database.transaction(async sql => {
      const result = await sql.run(`INSERT INTO profiles(name,daily_calories_target,daily_protein_target,daily_carbs_target,daily_fat_target,daily_sugar_target,daily_fiber_target,daily_salt_target) VALUES(?,?,?,?,?,?,?,?);`,[input.name.trim(),input.dailyCaloriesTarget,input.dailyProteinTarget ?? null,input.dailyCarbsTarget ?? null,input.dailyFatTarget ?? null,input.dailySugarTarget ?? null,input.dailyFiberTarget ?? null,input.dailySaltTarget ?? null])
      const id = lastInsertId(result)
      if (input.calorieDate) await history(sql,id,input,true)
      return get(sql,id)
    })
  }
  async function updateProfile(id: number,input: UpdateProfileInput) {
    assertId(id); validateProfileInput(input,true)
    return database.transaction(async sql => {
      if (!(await get(sql,id))) return null
      await history(sql,id,input)
      if (Object.values(input).some(value => value !== undefined)) await sql.run(`UPDATE profiles SET
        name=CASE WHEN ? THEN ? ELSE name END,
        daily_calories_target=CASE WHEN ? THEN ? ELSE daily_calories_target END,
        daily_protein_target=CASE WHEN ? THEN ? ELSE daily_protein_target END,
        daily_carbs_target=CASE WHEN ? THEN ? ELSE daily_carbs_target END,
        daily_fat_target=CASE WHEN ? THEN ? ELSE daily_fat_target END,
        daily_sugar_target=CASE WHEN ? THEN ? ELSE daily_sugar_target END,
        daily_fiber_target=CASE WHEN ? THEN ? ELSE daily_fiber_target END,
        daily_salt_target=CASE WHEN ? THEN ? ELSE daily_salt_target END,
        updated_at=CURRENT_TIMESTAMP WHERE id=?;`,[
        input.name !== undefined,input.name?.trim() ?? null,input.dailyCaloriesTarget !== undefined,input.dailyCaloriesTarget ?? null,
        input.dailyProteinTarget !== undefined,input.dailyProteinTarget ?? null,input.dailyCarbsTarget !== undefined,input.dailyCarbsTarget ?? null,
        input.dailyFatTarget !== undefined,input.dailyFatTarget ?? null,input.dailySugarTarget !== undefined,input.dailySugarTarget ?? null,
        input.dailyFiberTarget !== undefined,input.dailyFiberTarget ?? null,input.dailySaltTarget !== undefined,input.dailySaltTarget ?? null,id])
      return get(sql,id)
    })
  }
  async function deleteProfile(id: number) { assertId(id); return (await database.run('DELETE FROM profiles WHERE id=?;',[id])).changes?.changes ?? 0 }
  return { listProfiles,getProfileById,createProfile,updateProfile,deleteProfile }
}
export const { listProfiles,getProfileById,createProfile,updateProfile,deleteProfile } = createProfilesRepository(databaseSql)
