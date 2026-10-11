import { describe,it,expect,vi } from 'vitest'
import { createTestDatabase } from '../helpers/sqlite'
import { readProfileCalorieContext,appendProfileCalorieEvent } from '../../app/utils/database/repositories/profile-calorie-history'
import { configureProfileCalories,recordProfileWeight,recordManualCalorieTarget,profileGoalAt } from '../../shared/domain/profile-calorie-history'
import type { CalorieModelInput } from '../../shared/domain/calorie-model'
const today = '2026-10-11', stamp = { createdAt: '2026-10-11T12:00:00.000Z' }
const model: CalorieModelInput = { weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } }
async function setup() {
  const fixture = await createTestDatabase()
  const profile = await fixture.service.profiles.createProfile({ name: 'History',dailyCaloriesTarget: 1800 })
  return { ...fixture,profile: profile! }
}
async function enable(f: Awaited<ReturnType<typeof setup>>) {
  return f.database.transaction(async sql => {
    const context = await readProfileCalorieContext(sql,f.profile.id,today)
    const event = configureProfileCalories(context,{ mode: 'automatic',model,measuredOn: today },stamp)
    return appendProfileCalorieEvent(sql,f.profile.id,event)
  })
}
describe('SQLite profile calorie child aggregate', () => {
  it('preserves the separate manual target and journals the complete UUID-addressed profile', async () => {
    const f = await setup(), event = await enable(f)
    const context = await readProfileCalorieContext(f.database,f.profile.id,today)
    expect(context.history).toEqual([event]); expect(context.manualTargetKcal).toBe(1800)
    const rows = await f.database.query<{ entity: string; aggregate_uuid: string }>('SELECT entity,aggregate_uuid FROM sync_records WHERE uuid=?;',[event.id])
    expect(rows[0]).toEqual({ entity: 'profile_calorie_history',aggregate_uuid: context.profileId })
    const queue = await f.database.query<{ payload: string }>("SELECT payload FROM sync_outbox WHERE entity='profiles' ORDER BY sequence;")
    const payload = JSON.parse(queue.at(-1)!.payload)
    expect(payload.id).toBe(context.profileId); expect(payload.daily_calories_target).toBe(1800)
    expect(payload.calorie_history[0].id).toBe(event.id); expect(payload.calorie_history[0].profile_id).toBe(context.profileId)
    expect(JSON.parse(payload.calorie_history[0].event_json).state.calculation.targetKcal).toBe(2016)
    expect(JSON.parse(queue[0]!.payload)).not.toHaveProperty('calorie_history')
    f.close()
  })
  it('appends weight and target changes without replacing child IDs or earlier goal snapshots', async () => {
    const f = await setup(), initial = await enable(f)
    const original = await f.database.query('SELECT * FROM profile_calorie_history WHERE uuid=?;',[initial.id])
    await f.database.transaction(async sql => {
      const c = await readProfileCalorieContext(sql,f.profile.id,'2026-10-12')
      await appendProfileCalorieEvent(sql,f.profile.id,recordProfileWeight(c,{ weightKg: 80,measuredOn: '2026-10-12' },stamp))
    })
    await f.database.transaction(async sql => {
      const c = await readProfileCalorieContext(sql,f.profile.id,'2026-10-12')
      await appendProfileCalorieEvent(sql,f.profile.id,recordManualCalorieTarget(c,1700,stamp))
    })
    const current = await readProfileCalorieContext(f.database,f.profile.id,'2026-10-12')
    expect(current.history).toHaveLength(3); expect(current.manualTargetKcal).toBe(1700)
    expect(profileGoalAt(current.history,current.profileId,today)!.targetKcal).toBe(2016)
    expect(profileGoalAt(current.history,current.profileId,'2026-10-12')!.targetKcal).toBe(2304)
    expect(await f.database.query('SELECT * FROM profile_calorie_history WHERE uuid=?;',[initial.id])).toEqual(original)
    f.close()
  })
  it('SQL rejects mutating/reparenting or individually deleting history, but profile deletion cascades and tombstones UUIDs', async () => {
    const f = await setup(), event = await enable(f)
    await expect(f.database.run("UPDATE profile_calorie_history SET event_json='{}' WHERE uuid=?;",[event.id])).rejects.toThrow('immutable')
    await expect(f.database.run('UPDATE profile_calorie_history SET sequence=99 WHERE uuid=?;',[event.id])).rejects.toThrow('immutable')
    await expect(f.database.run('DELETE FROM profile_calorie_history WHERE uuid=?;',[event.id])).rejects.toThrow('immutable')
    expect((await readProfileCalorieContext(f.database,f.profile.id,today)).history).toHaveLength(1)
    await f.service.profiles.deleteProfile(f.profile.id)
    expect(await f.database.query('SELECT * FROM profile_calorie_history;')).toEqual([])
    const record = await f.database.query<{ deleted_at: string | null }>('SELECT deleted_at FROM sync_records WHERE uuid=?;',[event.id])
    expect(record[0]!.deleted_at).not.toBeNull()
    f.close()
  })
  it('rolls back manual target, history, identity and dirty/outbox rows together when journaling fails', async () => {
    const f = await setup(); await enable(f)
    const snapshot = () => Promise.all([
      f.database.query('SELECT * FROM profiles;'), f.database.query('SELECT * FROM profile_calorie_history;'),
      f.database.query('SELECT * FROM sync_records;'), f.database.query('SELECT * FROM sync_dirty;'), f.database.query('SELECT * FROM sync_outbox;'),
    ])
    const before = await snapshot()
    const run = f.driver.run.bind(f.driver)
    const spy = vi.spyOn(f.driver,'run').mockImplementation((statement,values) => {
      if (statement.includes('INSERT INTO sync_outbox')) throw new Error('journal failure')
      return run(statement,values)
    })
    await expect(f.database.transaction(async sql => {
      const c = await readProfileCalorieContext(sql,f.profile.id,today)
      await appendProfileCalorieEvent(sql,f.profile.id,recordManualCalorieTarget(c,1900,stamp))
    })).rejects.toThrow('journal failure')
    spy.mockRestore()
    expect(await snapshot()).toEqual(before)
    f.close()
  })
  it('rejects a foreign profile event and retains history across an SQLite persistence roundtrip', async () => {
    const f = await setup(), event = await enable(f)
    const second = await f.service.profiles.createProfile({ name: 'Other',dailyCaloriesTarget: 2000 })
    await expect(f.database.transaction(sql => appendProfileCalorieEvent(sql,second!.id,event))).rejects.toThrow()
    const restored = await createTestDatabase({ bytes: f.exportBytes() })
    expect((await readProfileCalorieContext(restored.database,f.profile.id,today)).history).toEqual([event])
    restored.close(); f.close()
  })
})
