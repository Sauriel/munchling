import { afterEach,describe,it,expect,vi } from 'vitest'
import { createTestDatabase } from '../helpers/sqlite'
import { binding,profile,snapshot,page,url } from '../helpers/sync-wire'
import { createSnapshotStaging } from '../../app/utils/sync/staging'
import { createRemoteReceiver } from '../../app/utils/sync/apply'
import { createSyncQueue } from '../../app/utils/database/outbox'
import { reactive } from 'vue'
import { createSyncDecisions } from '../../app/utils/sync/decisions'
import { calculateCaloriePlan } from '../../shared/domain/calorie-model'
import { configureProfileCalories,recordProfileWeight,confirmCalorieCalculation,profileGoalAt } from '../../shared/domain/profile-calorie-history'
import { encodeProfileCalorieEvent } from '../../shared/domain/profile-calorie-wire'
import { localCalendarDate } from '../../shared/domain/profile-calorie-command'
import type { CalorieModelInput } from '../../shared/domain/calorie-model'
const model: CalorieModelInput = { weightKg: 70,sleepHoursPerDay: 8,workKind: 'none',workHoursPerWeek: 0,sports: [],deficit: { mode: 'absolute',value: 0 } }
const fixtures: Awaited<ReturnType<typeof createTestDatabase>>[] = []
async function open() { const db = await createTestDatabase(); fixtures.push(db); return db }
afterEach(() => { fixtures.splice(0).forEach(db => db.close()); vi.useRealTimers() })
function remote() {
  const p = profile(),context = { profileId: p.id,today: '2026-10-11',manualTargetKcal: 2000,history: [] }
  const event = configureProfileCalories(context,{ mode: 'automatic',model,measuredOn: context.today })
  p.data!.calorie_history = [encodeProfileCalorieEvent(event)]
  return { p,event,context }
}
async function adopt(db: Awaited<ReturnType<typeof open>>,p: ReturnType<typeof profile>) {
  const staging = createSnapshotStaging(db.database),epoch = (await staging.state()).localEpoch,receiver = createRemoteReceiver(db.database)
  const cut = snapshot([p]); cut.identities.push(...(p.data!.calorie_history as { id: string }[]).map(row => ({ uuid: row.id,entity: 'profile_calorie_history' as const,aggregateUuid: p.id,version: 1,deletedAt: null })))
  await staging.begin(epoch,url,cut)
  expect((await receiver.adoptSnapshot(epoch)).status).toBe('applied')
  return { receiver,context: { ...binding,localEpoch: epoch,url,cursor: '0' } }
}
describe('profile calorie service, backups and sync integration',() => {
  it('initializes a dated manual target and exposes persisted history through the regular profile service',async () => {
    const db = await open(),today = localCalendarDate()
    const p = await db.service.profiles.createProfile({ name: 'Profile',dailyCaloriesTarget: 1800,calorieDate: today })
    expect(p!.calorieHistory).toHaveLength(1)
    const updated = await db.service.profiles.updateProfile(p!.id,{ calorieDate: today,calorieChange: { kind: 'configure',mode: 'automatic',model,measuredOn: today } })
    expect(updated!.dailyCaloriesTarget).toBe(1800)
    expect(updated!.calorieHistory!.at(-1)!.state.calculation!.targetKcal).toBe(2016)
    const disabled = await db.service.profiles.updateProfile(p!.id,{ calorieDate: today,calorieChange: { kind: 'configure',mode: 'manual' } })
    expect(disabled!.calorieHistory!.at(-1)!.state).toMatchObject({ mode: 'manual',manualTargetKcal: 1800 })
  })
  it('roundtrips v5 backup including exact original event JSON, identities, local IDs and goals',async () => {
    const db = await open(),{p} = remote(); await adopt(db,p)
    const before = await db.database.query('SELECT * FROM profile_calorie_history;'),backup = await db.service.backups!.exportBackup()
    expect(backup.version).toBe(5); expect(backup.data.profileCalorieHistory).toHaveLength(1)
    await db.service.backups!.restoreBackup(backup,async () => {})
    expect(await db.database.query('SELECT * FROM profile_calorie_history;')).toEqual(before)
    const after = await db.service.backups!.exportBackup()
    expect(after.data).toEqual(backup.data)
    if (backup.version === 1 || after.version === 1) throw new Error('missing identities')
    expect(after.identities).toEqual(backup.identities)
  })
  it('appends received observations without updating or reinserting unchanged child rows or emitting echoes',async () => {
    const db = await open(),{p,event,context:c} = remote(),{ receiver,context } = await adopt(db,p)
    const before = (await db.database.query('SELECT * FROM profile_calorie_history;'))[0]
    const next = recordProfileWeight({ ...c,history: [event],today: '2026-10-12' },{ weightKg: 80,measuredOn: '2026-10-12' })
    const changed = { ...p,version: 2,data: { ...p.data!,calorie_history: [...p.data!.calorie_history as unknown[],encodeProfileCalorieEvent(next)] } }
    expect((await receiver.applyPage(context,page([changed])))[0]!.status).toBe('applied')
    expect((await db.database.query('SELECT * FROM profile_calorie_history WHERE uuid=?;',[event.id]))[0]).toEqual(before)
    expect((await db.service.profiles.listProfiles())[0]!.calorieHistory).toHaveLength(2)
    expect(await createSyncQueue(db.database).list()).toEqual([])
    expect((await receiver.applyPage({ ...context,cursor: '1' },page([{ ...changed,version: 3,data: { ...changed.data,name: 'Renamed' } }],1)))[0]!.status).toBe('applied')
  })
  it('blocks removed or byte-rewritten accepted history and retains original rows',async () => {
    for (const rewrite of [false,true]) {
      const db = await open(),{p} = remote(),{ receiver,context } = await adopt(db,p),before = await db.database.query('SELECT * FROM profile_calorie_history;')
      const rows = p.data!.calorie_history as { event_json: string }[]
      const data = { ...p.data!,calorie_history: rewrite ? rows.map(row => ({ ...row,event_json: JSON.stringify(JSON.parse(row.event_json),null,2) })) : [] }
      expect((await receiver.applyPage(context,page([{ ...p,version: 2,data }])))[0]).toMatchObject({ status: 'blocked',reason: 'historyImmutable' })
      expect(await db.database.query('SELECT * FROM profile_calorie_history;')).toEqual(before)
    }
  })
  it('whole-profile server deletion removes history without queuing an echo and retains tombstones',async () => {
    const db = await open(),{p,event} = remote(),{ receiver,context } = await adopt(db,p)
    expect((await receiver.applyPage(context,page([{ ...p,version: 2,data: null,deletedAt: '2026-10-12T12:00:00.000Z' }])))[0]!.status).toBe('applied')
    expect(await db.database.query('SELECT * FROM profile_calorie_history;')).toEqual([])
    expect((await db.database.query<{ deleted_at: string | null }>('SELECT deleted_at FROM sync_records WHERE uuid=?;',[event.id]))[0]!.deleted_at).not.toBeNull()
    expect(await createSyncQueue(db.database).list()).toEqual([])
  })
  it('rejects new zero targets and binds a low-target confirmation to exact profile/date/calculation',async () => {
    const db = await open(),today = localCalendarDate()
    await expect(db.service.profiles.createProfile({ name: 'Zero',dailyCaloriesTarget: 0 })).rejects.toThrow('invalidNumber')
    const p = (await db.service.profiles.createProfile({ name: 'Warning',dailyCaloriesTarget: 2000 }))!,low = { ...model,weightKg: 40 }
    const change = { kind: 'configure' as const,mode: 'automatic' as const,model: low,measuredOn: today }
    await expect(db.service.profiles.updateProfile(p.id,{ calorieDate: today,calorieChange: change })).rejects.toThrow('confirmCalorieWarning')
    const confirmation = confirmCalorieCalculation(p.uuid!,today,calculateCaloriePlan(low))
    await expect(db.service.profiles.updateProfile(p.id,{ calorieDate: today,calorieChange: { ...change,model: { ...low,weightKg: 45 },confirmation } })).rejects.toThrow('confirmCalorieWarning')
    const accepted = await db.service.profiles.updateProfile(p.id,{ calorieDate: today,calorieChange: { ...change,confirmation } })
    expect(accepted!.calorieHistory!.at(-1)!.state.calculation!.targetKcal).toBe(1152)
  })
  it('reads detached historical facts from Vue reactive DTOs without proxy-cloning errors',async () => {
    const f = remote(),dto = reactive({ history: [f.event] })
    const goal = profileGoalAt(dto.history,f.p.id,f.context.today)!
    goal.state.calculation!.input.weightKg = 99
    expect(dto.history[0]!.state.calculation!.input.weightKg).toBe(70)
  })
  it('requires explicit conflict choice, preserves accepted child IDs and archives a discarded offline weight draft',async () => {
    const db = await open(),f = remote(),{ receiver,context } = await adopt(db,f.p)
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00'))
    const p = (await db.service.profiles.listProfiles())[0]!,today = localCalendarDate()
    await db.service.profiles.updateProfile(p.id,{ calorieDate: today,calorieChange: { kind: 'weight',weightKg: 75,measuredOn: today } })
    const localRows = await db.database.query('SELECT * FROM profile_calorie_history;'),queue = await createSyncQueue(db.database).list()
    const event = recordProfileWeight({ ...f.context,today,history: [f.event] },{ weightKg: 80,measuredOn: today })
    const changed = { ...f.p,version: 2,data: { ...f.p.data!,calorie_history: [...f.p.data!.calorie_history as unknown[],encodeProfileCalorieEvent(event)] } }
    expect((await receiver.applyPage(context,page([changed])))[0]!.reason).toBe('localChanges')
    const proof = snapshot([changed],'1'); proof.identities.push(...[f.event,event].map(row => ({ uuid: row.id,entity: 'profile_calorie_history' as const,aggregateUuid: f.p.id,version: 1,deletedAt: null })))
    const saveSafety = vi.fn(async () => {}),decisions = createSyncDecisions(db.database,saveSafety),review = await decisions.conflictPreview([proof])
    await expect(decisions.resolve(review.token,{ [f.p.id]: 'local' },[proof])).rejects.toThrow()
    expect(await db.database.query('SELECT * FROM profile_calorie_history;')).toEqual(localRows)
    expect(await createSyncQueue(db.database).list()).toEqual(queue)
    await decisions.resolve(review.token,{ [f.p.id]: 'server' },[proof])
    expect(saveSafety).toHaveBeenCalledOnce()
    const restored = (await db.service.profiles.listProfiles())[0]!
    expect(restored.id).toBe(p.id); expect(restored.calorieHistory).toEqual([f.event,event])
    expect((await db.database.query('SELECT * FROM profile_calorie_history WHERE uuid=?;',[f.event.id]))[0]).toEqual(localRows[0])
    expect(await createSyncQueue(db.database).list()).toEqual([])
  })
  it('rejects an editor left open over midnight instead of silently changing the confirmed goal date',async () => {
    const db = await open(),today = localCalendarDate(),p = await db.service.profiles.createProfile({ name: 'Midnight',dailyCaloriesTarget: 2000 })
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.now()+86400000))
    await expect(db.service.profiles.updateProfile(p!.id,{ calorieDate: today,calorieChange: { kind: 'configure',mode: 'automatic',model,measuredOn: today } })).rejects.toThrow('calorieDateChanged')
    expect((await db.service.profiles.getProfileById(p!.id))!.calorieHistory).toEqual([])
  })
})
