import { describe,it,expect } from 'vitest'
import { calculateCaloriePlan,calorieDayBudget,calorieModelVersion,type CalorieModelInput } from '../../shared/domain/calorie-model'
const base = (): CalorieModelInput => ({ weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } })
describe('explicit versioned MET estimate', () => {
  it('requires explicit personal input and keeps zero deficit without hidden assumptions', () => {
    const result = calculateCaloriePlan(base())
    expect(result.estimatedNeedKcal).toBe(2016); expect(result.targetKcal).toBe(2016)
    expect(result.breakdown.restHours).toBe(16); expect(result.warnings).toEqual([])
    expect(result.modelVersion).toBe(calorieModelVersion)
    expect(result.factors.sleep.met).toBe(1); expect(result.factors.rest.kind).toBe('assumption')
    for (const field of ['weightKg','sleepHoursPerDay','workHoursPerWeek','workKind','sports','deficit']) {
      const input = base() as any; delete input[field]; expect(() => calculateCaloriePlan(input)).toThrow()
    }
  })
  it('averages weekly work/sport into a complete 24-hour day without intermediate rounding', () => {
    const input = { ...base(),weightKg: 80,workHoursPerWeek: 40,workKind: 'seated' as const,sports: [{ intensity: 'moderate' as const,hoursPerWeek: 7 }] }
    const result = calculateCaloriePlan(input)
    expect(result.breakdown.workHours).toBe(40 / 7); expect(result.breakdown.sports[0]!.hours).toBe(1)
    expect(result.breakdown.restHours).toBeCloseTo(24 - 8 - 40 / 7 - 1)
    expect(result.targetKcal).toBe(2691)
  })
  it('supports absolute and percent deficit, warns without silently clamping', () => {
    expect(calculateCaloriePlan({ ...base(),deficit: { mode: 'absolute',value: 500 } }).targetKcal).toBe(1516)
    expect(calculateCaloriePlan({ ...base(),deficit: { mode: 'percent',value: 25 } }).targetKcal).toBe(1512)
    const low = calculateCaloriePlan({ ...base(),deficit: { mode: 'absolute',value: 800 } })
    expect(low.targetKcal).toBe(1216); expect(low.warnings).toEqual(['lowTarget','largeDeficit'])
  })
  it.each([0,-1,NaN,Infinity])('rejects invalid weight %s', weightKg => { expect(() => calculateCaloriePlan({ ...base(),weightKg })).toThrow() })
  it('rejects overlapping time, unsupported categories, missing/duplicate sports and impossible deficits', () => {
    const variants: any[] = [
      { sleepHoursPerDay: 25 }, { workHoursPerWeek: 169 }, { workHoursPerWeek: 112,workKind: 'physical',sports: [{ intensity: 'gentle',hoursPerWeek: 7 }] },
      { workKind: 'unknown' }, { workKind: 'none',workHoursPerWeek: 1 }, { sports: null },
      { sports: [{ intensity: 'unknown',hoursPerWeek: 1 }] }, { sports: [{ intensity: 'gentle',hoursPerWeek: -1 }] },
      { sports: [{ intensity: 'gentle',hoursPerWeek: 1 },{ intensity: 'gentle',hoursPerWeek: 2 }] },
      { deficit: { mode: 'percent',value: 100 } },{ deficit: { mode: 'absolute',value: 2016 } },{ deficit: { mode: 'absolute',value: 3000 } },
    ]
    for (const variant of variants) expect(() => calculateCaloriePlan({ ...base(),...variant })).toThrow()
  })
  it('returned input and factor snapshots cannot mutate the next calculation', () => {
    const input = base(), result = calculateCaloriePlan(input)
    result.input.weightKg = 99; (result.factors.rest as any).met = 999
    expect(input.weightKg).toBe(70); expect(calculateCaloriePlan(input).targetKcal).toBe(2016)
  })
  it('keeps explicitly booked bonuses additive and outside the baseline model', () => {
    const model = calculateCaloriePlan(base())
    expect(calorieDayBudget(model.targetKcal,199.5)).toEqual({ baseTargetKcal: 2016,extraActivityKcal: 199.5,totalKcal: 2215.5 })
    expect(model.targetKcal).toBe(2016)
    expect(() => calorieDayBudget(0,10)).toThrow(); expect(() => calorieDayBudget(2000,-1)).toThrow()
  })
})
