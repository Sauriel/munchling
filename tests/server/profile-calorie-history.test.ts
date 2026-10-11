import { afterAll,beforeAll,beforeEach,describe,it,expect } from 'vitest'
import { newDatabase,resetDatabase } from './helpers'
import type { ServerDatabase } from '../../server/database/connection'
import { appendServerProfileCalorieHistory,readServerProfileCalorieHistory,tombstoneServerProfileCalorieHistory } from '../../server/services/profile-calorie-history'
import { upsertRow,reserveIdentity } from '../../server/services/storage'
import { createUuid } from '../../shared/domain/sync'
import { configureProfileCalories,recordProfileWeight,type CalorieHistoryContext } from '../../shared/domain/profile-calorie-history'
import { encodeProfileCalorieEvent,type ProfileCalorieWireRow } from '../../shared/domain/profile-calorie-wire'
import { createTestDatabase } from '../helpers/sqlite'
import { appendProfileCalorieEvent,readProfileCalorieContext } from '../../app/utils/database/repositories/profile-calorie-history'
const today = '2026-10-11', timestamp = '2026-10-11T12:00:00.000Z'
describe('MariaDB immutable profile history', () => {
  let db: ServerDatabase
  beforeAll(() => { db = newDatabase() })
  beforeEach(async () => {
    await resetDatabase(db)
  })
  afterAll(async () => { await db.close() })
  async function initial() {
    const id = createUuid()
    await db.transaction(async sql => {
      await reserveIdentity(sql,id,'profiles',id)
      await upsertRow(sql,'profiles',{ id,name: 'History',daily_calories_target: 1800,daily_protein_target: null,daily_carbs_target: null,daily_fat_target: null,daily_sugar_target: null,daily_fiber_target: null,daily_salt_target: null,created_at: timestamp,updated_at: null })
    })
    const context: CalorieHistoryContext = { profileId: id,today,manualTargetKcal: 1800,history: [] }
    const event = configureProfileCalories(context,{ mode: 'automatic',model: { weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } },measuredOn: today },{ createdAt: timestamp })
    const row = encodeProfileCalorieEvent(event)
    await db.transaction(async sql => {
      await sql.query('SELECT id FROM server_state WHERE id=1 FOR UPDATE')
      await appendServerProfileCalorieHistory(sql,id,[row],1800,1800)
    })
    return { id,context,event,row }
  }
  it('accepts actual SQLite outbox child bytes without remapping UUIDs or recalculating archived goals', async () => {
    const local = await createTestDatabase()
    try {
      const profile = await local.service.profiles.createProfile({ name: 'From SQLite',dailyCaloriesTarget: 1800 })
      await local.database.transaction(async sql => {
        const context = await readProfileCalorieContext(sql,profile!.id,today)
        const event = configureProfileCalories(context,{ mode: 'automatic',model: { weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'percent',value: 0 } },measuredOn: today },{ createdAt: timestamp })
        await appendProfileCalorieEvent(sql,profile!.id,event)
      })
      const queued = await local.database.query<{ payload: string }>("SELECT payload FROM sync_outbox WHERE entity='profiles' ORDER BY sequence DESC LIMIT 1;")
      const payload = JSON.parse(queued[0]!.payload), children = payload.calorie_history as ProfileCalorieWireRow[]
      await db.transaction(async sql => {
        await sql.query('SELECT id FROM server_state WHERE id=1 FOR UPDATE')
        await reserveIdentity(sql,payload.id,'profiles',payload.id)
        await upsertRow(sql,'profiles',payload)
        await appendServerProfileCalorieHistory(sql,payload.id,children,1800,1800)
      })
      expect(await db.withConnection(sql => readServerProfileCalorieHistory(sql,payload.id))).toEqual(children)
    } finally { local.close() }
  })
  it('stores exact original JSON, dates and child UUID; unchanged replay preserves view ID and child revision', async () => {
    const { id,row } = await initial()
    const before = await db.withConnection(sql => sql.query('SELECT * FROM profile_calorie_history WHERE uuid=?',[row.id]))
    await db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[row],1800,1800))
    expect(await db.withConnection(sql => readServerProfileCalorieHistory(sql,id))).toEqual([row])
    expect(await db.withConnection(sql => sql.query('SELECT * FROM profile_calorie_history WHERE uuid=?',[row.id]))).toEqual(before)
    const meta = await db.withConnection(sql => sql.query<{ version: number; entity: string }>('SELECT version,entity FROM sync_identities WHERE uuid=?',[row.id]))
    expect(meta[0]).toEqual({ version: 1,entity: 'profile_calorie_history' })
  })
  it('appends new weight without replacing an old child; rejects missing or altered accepted history', async () => {
    const { id,context,event,row } = await initial()
    const newer = encodeProfileCalorieEvent(recordProfileWeight({ ...context,today: '2026-10-12',history: [event] },{ weightKg: 80,measuredOn: '2026-10-12' }))
    await db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[row,newer],1800,1800))
    const rows = await db.withConnection(sql => readServerProfileCalorieHistory(sql,id))
    expect(rows).toEqual([row,newer])
    await expect(db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[newer],1800,1800))).rejects.toThrow()
    await expect(db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[{ ...row,event_json: JSON.stringify(JSON.parse(row.event_json),null,2) },newer],1800,1800))).rejects.toThrow()
    expect(await db.withConnection(sql => readServerProfileCalorieHistory(sql,id))).toEqual(rows)
  })
  it('rejects an invalid new calculation and rolls back earlier business writes', async () => {
    const { id,context,event,row } = await initial()
    const newer = encodeProfileCalorieEvent(recordProfileWeight({ ...context,history: [event] },{ weightKg: 80,measuredOn: today }))
    const body = JSON.parse(newer.event_json); body.state.calculation.targetKcal = 9999
    await expect(db.transaction(async sql => {
      await sql.write('UPDATE profiles SET name=? WHERE uuid=?',['Must rollback',id])
      await appendServerProfileCalorieHistory(sql,id,[row,{ ...newer,event_json: JSON.stringify(body) }],1800,1800)
    })).rejects.toThrow()
    const parent = await db.withConnection(sql => sql.query<{ name: string }>('SELECT name FROM profiles WHERE uuid=?',[id]))
    expect(parent[0]!.name).toBe('History')
    expect(await db.withConnection(sql => readServerProfileCalorieHistory(sql,id))).toEqual([row])
  })
  it('rejects reusing a reserved UUID and tombstones children only for explicit whole-profile deletion', async () => {
    const { id,context,event,row } = await initial()
    const newer = encodeProfileCalorieEvent(recordProfileWeight({ ...context,history: [event] },{ weightKg: 80,measuredOn: today }))
    await db.transaction(sql => reserveIdentity(sql,newer.id,'foods',newer.id))
    await expect(db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[row,newer],1800,1800))).rejects.toMatchObject({ code: 'identityConflict' })
    await db.transaction(sql => tombstoneServerProfileCalorieHistory(sql,id,timestamp))
    expect(await db.withConnection(sql => readServerProfileCalorieHistory(sql,id))).toEqual([])
    const tombstone = await db.withConnection(sql => sql.query<{ version: number; deleted_at: unknown }>('SELECT version,deleted_at FROM sync_identities WHERE uuid=?',[row.id]))
    expect(tombstone[0]!.version).toBe(2); expect(tombstone[0]!.deleted_at).not.toBeNull()
    await expect(db.transaction(sql => appendServerProfileCalorieHistory(sql,id,[row],1800,1800))).rejects.toMatchObject({ code: 'identityConflict' })
  })
})
