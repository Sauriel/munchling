import { describe,it,expect } from 'vitest'
import { createUuid } from '../../shared/domain/sync'
import { configureProfileCalories,recordProfileWeight,recordManualCalorieTarget,type CalorieHistoryContext } from '../../shared/domain/profile-calorie-history'
import { encodeProfileCalorieEvent,decodeProfileCalorieRows,verifyProfileCalorieWrite } from '../../shared/domain/profile-calorie-wire'
import type { CalorieModelInput } from '../../shared/domain/calorie-model'
const model: CalorieModelInput = { weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } }
function fixture() {
  const context: CalorieHistoryContext = { profileId: createUuid(),today: '2026-10-11',manualTargetKcal: 1800,history: [] }
  const event = configureProfileCalories(context,{ mode: 'automatic',model,measuredOn: context.today },{ createdAt: '2026-10-11T12:00:00.000Z' })
  return { context,event,row: encodeProfileCalorieEvent(event) }
}
describe('profile history wire codec and authoritative new-write validation', () => {
  it('roundtrips UUID/date/factors without mutating original bytes', () => {
    const { context,event,row } = fixture(), before = structuredClone(row)
    row.event_json = JSON.stringify(JSON.parse(row.event_json),null,2)
    const originalBytes = row.event_json
    expect(decodeProfileCalorieRows([row],context.profileId)).toEqual([event])
    expect(row.event_json).toBe(originalBytes); expect(before.created_at).toBe(event.createdAt)
    expect(verifyProfileCalorieWrite([], [row],context.profileId,1800,1800)).toEqual([event])
  })
  it('permits absent legacy history and does not synthesize dates for an old manual profile', () => {
    const id = createUuid(); expect(verifyProfileCalorieWrite([],[],id,1800,1900)).toEqual([])
  })
  it('rejects malformed JSON, unknown columns, foreign IDs, duplicate sequence and local numeric IDs', () => {
    const { context,row } = fixture()
    const bad = [ { ...row,id: 1 },{ ...row,profile_id: createUuid() },{ ...row,event_json: 'bad' },{ ...row,extra: 'bad' },{ ...row,event_json: '{}' },{ ...row,created_at: undefined },{ ...row,created_at: '2026-10-11T12:00Z' } ]
    for (const value of bad) expect(() => decodeProfileCalorieRows([value],context.profileId)).toThrow()
    expect(() => decodeProfileCalorieRows([row,{ ...row,id: createUuid() }],context.profileId)).toThrow()
  })
  it('preserves a legacy zero manual value, but rejects newly entered nonpositive targets', () => {
    const c: CalorieHistoryContext = { profileId: createUuid(),today: '2026-10-11',manualTargetKcal: 0,history: [] }
    const observation = encodeProfileCalorieEvent(recordProfileWeight(c,{ weightKg: 70,measuredOn: c.today }))
    expect(verifyProfileCalorieWrite([],[observation],c.profileId,0,0)).toHaveLength(1)
    expect(() => recordManualCalorieTarget(c,0)).toThrow()
    expect(() => configureProfileCalories(c,{ mode: 'manual' })).toThrow()
  })
  it('retains original unknown historical model versions while rejecting newly claimed invalid versions/results', () => {
    const { context,row } = fixture()
    const body = JSON.parse(row.event_json); body.state.calculation.modelVersion = 'old-model'; body.state.calculation.targetKcal = 2050
    const historical = { ...row,event_json: JSON.stringify(body) }
    expect(verifyProfileCalorieWrite([historical],[historical],context.profileId,1800,1800)[0]!.state.calculation!.targetKcal).toBe(2050)
    expect(() => verifyProfileCalorieWrite([],[historical],context.profileId,1800,1800)).toThrow()
  })
  it('rejects missing or changed accepted children including byte-only JSON rewrites', () => {
    const { context,row } = fixture()
    expect(() => verifyProfileCalorieWrite([row],[],context.profileId,1800,1800)).toThrow()
    const changed = { ...row,event_json: JSON.stringify(JSON.parse(row.event_json),null,2) }
    expect(() => verifyProfileCalorieWrite([row],[changed],context.profileId,1800,1800)).toThrow()
  })
  it('validates new weight against previous settings, not an arbitrary draft deficit', () => {
    const { context,event,row } = fixture(), c = { ...context,today: '2026-10-12',history: [event] }
    const next = encodeProfileCalorieEvent(recordProfileWeight(c,{ weightKg: 80,measuredOn: c.today }))
    expect(verifyProfileCalorieWrite([row],[next,row],c.profileId,1800,1800)).toHaveLength(2)
    const body = JSON.parse(next.event_json); body.state.calculation.input.deficit.value = 100
    expect(() => verifyProfileCalorieWrite([row],[row,{ ...next,event_json: JSON.stringify(body) }],c.profileId,1800,1800)).toThrow()
  })
  it('checks manual scalar/state agreement and does not allow a weight event to toggle mode', () => {
    const { context,event,row } = fixture(), c = { ...context,history: [event] }
    const manual = encodeProfileCalorieEvent(recordManualCalorieTarget(c,1700))
    expect(verifyProfileCalorieWrite([row],[row,manual],c.profileId,1800,1700)).toHaveLength(2)
    expect(() => verifyProfileCalorieWrite([row],[row],c.profileId,1800,1700)).toThrow()
    const body = JSON.parse(manual.event_json); body.kind = 'weight'; body.measurement = { weightKg: 70,measuredOn: c.today }; body.state.mode = 'manual'
    expect(() => verifyProfileCalorieWrite([row],[row,{ ...manual,event_json: JSON.stringify(body) }],c.profileId,1800,1700)).toThrow()
  })
  it('preserves a later current measurement when appending an older observation', () => {
    const { context,event,row } = fixture(), c = { ...context,today: '2026-10-12',history: [event] }
    const older = encodeProfileCalorieEvent(recordProfileWeight(c,{ weightKg: 60,measuredOn: '2026-10-01' }))
    expect(verifyProfileCalorieWrite([row],[row,older],c.profileId,1800,1800)[1]!.state.calculation!.input.weightKg).toBe(70)
  })
})
