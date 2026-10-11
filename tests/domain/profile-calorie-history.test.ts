import { describe,it,expect } from 'vitest'
import { createUuid } from '../../shared/domain/sync'
import { calculateCaloriePlan,type CalorieModelInput } from '../../shared/domain/calorie-model'
import { confirmCalorieCalculation,configureProfileCalories,recordProfileWeight,recordManualCalorieTarget,profileGoalAt,profileWeightAt,assertProfileCalorieAppendOnly,validateProfileCalorieHistory,type CalorieHistoryContext,type ProfileCalorieEvent } from '../../shared/domain/profile-calorie-history'
const model = (weightKg = 70): CalorieModelInput => ({ weightKg,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } })
const context = (history: ProfileCalorieEvent[] = []): CalorieHistoryContext => ({ profileId: createUuid(),today: '2026-10-11',manualTargetKcal: 1800,history })
const timestamp = { createdAt: '2026-10-11T12:00:00.000Z' }
function automated(c: CalorieHistoryContext) { return configureProfileCalories(c,{ mode: 'automatic',model: model(),measuredOn: c.today },timestamp) }
describe('immutable dated profile calorie history', () => {
  it('requires explicit model/weight date and does not fabricate historical targets', () => {
    const c = context()
    expect(profileGoalAt([],c.profileId,'2020-01-01')).toBeNull()
    expect(() => configureProfileCalories(c,{ mode: 'automatic' },timestamp)).toThrow()
    expect(() => configureProfileCalories(c,{ mode: 'automatic',model: model() },timestamp)).toThrow()
    const row = automated(c)
    expect(row.state.calculation!.targetKcal).toBe(2016); expect(row.state.manualTargetKcal).toBe(1800)
    expect(row.measurement).toEqual({ weightKg: 70,measuredOn: c.today })
    expect(profileGoalAt([row],c.profileId,'2026-10-10')).toBeNull()
  })
  it('new weight recalculates from stored settings without altering yesterday or its factors', () => {
    const c = context(), initial = automated(c), before = structuredClone(initial)
    const next = recordProfileWeight({ ...c,today: '2026-10-12',history: [initial] },{ weightKg: 80,measuredOn: '2026-10-12' },timestamp)
    expect(next.state.calculation!.targetKcal).toBe(2304)
    expect(profileGoalAt([initial,next],c.profileId,'2026-10-11')!.targetKcal).toBe(2016)
    expect(profileGoalAt([initial,next],c.profileId,'2026-10-12')!.targetKcal).toBe(2304)
    expect(initial).toEqual(before); expect(next.sequence).toBe(2)
    expect(next.state.calculation!.factors).toEqual(initial.state.calculation!.factors)
  })
  it('manual target remains independent while automatic and restores when disabled', () => {
    const c = context(), initial = automated(c)
    const manual = recordManualCalorieTarget({ ...c,history: [initial] },1750,timestamp)
    expect(manual.state.mode).toBe('automatic'); expect(manual.state.manualTargetKcal).toBe(1750)
    expect(profileGoalAt([initial,manual],c.profileId,c.today)!.targetKcal).toBe(2016)
    const off = configureProfileCalories({ ...c,today: '2026-10-12',manualTargetKcal: 1750,history: [initial,manual] },{ mode: 'manual' },timestamp)
    expect(profileGoalAt([initial,manual,off],c.profileId,'2026-10-11')!.targetKcal).toBe(2016)
    expect(profileGoalAt([initial,manual,off],c.profileId,'2026-10-12')!.targetKcal).toBe(1750)
    expect(off.state.calculation).toEqual(initial.state.calculation)
  })
  it('explicit old weight observation does not replace a newer current measurement or rewrite goals', () => {
    const c = context(), initial = automated(c)
    const older = recordProfileWeight({ ...c,today: '2026-10-12',history: [initial] },{ weightKg: 60,measuredOn: '2026-10-01' },timestamp)
    expect(older.measurement!.weightKg).toBe(60); expect(older.state.calculation!.input.weightKg).toBe(70)
    expect(profileWeightAt([initial,older],c.profileId,'2026-10-12')!.weightKg).toBe(70)
    expect(profileWeightAt([initial,older],c.profileId,'2026-10-02')!.weightKg).toBe(60)
    expect(profileGoalAt([initial,older],c.profileId,'2026-10-02')).toBeNull()
  })
  it('current weight changes in manual mode do not secretly enable automation', () => {
    const c = context(), row = recordProfileWeight(c,{ weightKg: 80,measuredOn: c.today },timestamp)
    expect(row.state).toEqual({ mode: 'manual',manualTargetKcal: 1800,calculation: null })
    expect(profileGoalAt([row],c.profileId,c.today)!.targetKcal).toBe(1800)
  })
  it('dangerous new calculations require confirmation and leave original history intact', () => {
    const c = context(), initial = automated(c), before = structuredClone(initial)
    const input = { mode: 'automatic' as const,model: { ...model(),deficit: { mode: 'absolute' as const,value: 800 } },measuredOn: c.today }
    expect(() => configureProfileCalories({ ...c,history: [initial] },input,timestamp)).toThrow('confirmCalorieWarning')
    const confirmation = confirmCalorieCalculation(c.profileId,c.today,calculateCaloriePlan(input.model))
    expect(configureProfileCalories({ ...c,history: [initial] },{ ...input,confirmation },timestamp).state.calculation!.targetKcal).toBe(1216)
    expect(() => configureProfileCalories({ ...c,history: [initial] },{ ...input,model: { ...input.model,weightKg: 71 },confirmation },timestamp)).toThrow('confirmCalorieWarning')
    expect(() => configureProfileCalories({ ...c,today: '2026-10-12',history: [initial] },{ ...input,confirmation },timestamp)).toThrow('confirmCalorieWarning')
    expect(() => configureProfileCalories(context(),{ ...input,confirmation },timestamp)).toThrow('confirmCalorieWarning')
    expect(initial).toEqual(before)
    const severe = { ...initial,state: { ...initial.state,calculation: calculateCaloriePlan({ ...model(),deficit: { mode: 'absolute',value: 500 } }) } }
    expect(() => recordProfileWeight({ ...c,history: [severe] },{ weightKg: 50,measuredOn: c.today },timestamp)).toThrow('confirmCalorieWarning')
  })
  it('rejects deleting/mutating/duplicating historical children, foreign ownership and backdating', () => {
    const c = context(), initial = automated(c), next = recordManualCalorieTarget({ ...c,history: [initial] },1900,timestamp)
    expect(() => assertProfileCalorieAppendOnly([initial],[next],c.profileId)).toThrow('historyImmutable')
    const changed = structuredClone(initial); changed.state.calculation!.targetKcal = 999
    expect(() => assertProfileCalorieAppendOnly([initial],[changed],c.profileId)).toThrow('historyImmutable')
    expect(() => validateProfileCalorieHistory([initial,{ ...next,id: initial.id }],c.profileId)).toThrow()
    expect(() => validateProfileCalorieHistory([initial,{ ...next,sequence: initial.sequence }],c.profileId)).toThrow()
    expect(() => validateProfileCalorieHistory([initial],createUuid())).toThrow()
    expect(() => configureProfileCalories({ ...c,today: '2026-10-10',history: [initial] },{ mode: 'manual' },timestamp)).toThrow('historyDateConflict')
    expect(() => recordProfileWeight(c,{ weightKg: 80,measuredOn: '2026-10-12' },timestamp)).toThrow('historyDateConflict')
    expect(() => configureProfileCalories(c,{ mode: 'automatic',model: model(),measuredOn: '2026-10-12' },timestamp)).toThrow('historyDateConflict')
  })
  it('projection is independent of array/local ID order and returned state cannot edit history', () => {
    const c = context(), first = automated(c), next = recordManualCalorieTarget({ ...c,history: [first] },1900,timestamp)
    expect(() => assertProfileCalorieAppendOnly([first],[next,first],c.profileId)).not.toThrow()
    const result = profileGoalAt([next,first],c.profileId,c.today)!; result.state.calculation!.input.weightKg = 999
    expect(first.state.calculation!.input.weightKg).toBe(70); expect(next.state.calculation!.input.weightKg).toBe(70)
    expect(result.eventId).toBe(next.id)
  })
  it('rejects malformed nested persisted values and fractional manual targets', () => {
    const c = context(), initial = automated(c)
    const edits: ((row: any) => void)[] = [
      row => { row.state = null }, row => { row.measurement = undefined }, row => { row.state.manualTargetKcal = 1234.5 },
      row => { row.state.calculation.input = null }, row => { row.state.calculation.factors.rest.met = NaN },
      row => { row.state.calculation.factors.rest.source = undefined }, row => { row.state.calculation.breakdown.restHours = -1 },
      row => { row.state.calculation.warnings = ['unknown'] }, row => { row.state.calculation = undefined },
    ]
    for (const edit of edits) { const bad = structuredClone(initial); edit(bad); expect(() => validateProfileCalorieHistory([bad],c.profileId)).toThrow() }
    expect(() => recordManualCalorieTarget(c,1750.5,timestamp)).toThrow()
  })
  it('old factor/version snapshots remain historical facts instead of being recalculated', () => {
    const c = context(), initial = automated(c)
    initial.state.calculation!.modelVersion = 'historical-factor-set'; initial.state.calculation!.targetKcal = 2050
    expect(profileGoalAt([initial],c.profileId,c.today)!.targetKcal).toBe(2050)
  })
})
