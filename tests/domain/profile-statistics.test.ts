import { it, expect } from 'vitest'
import { sortProfiles } from '../../shared/domain/profile-order'
import { buildProfileStatistics, statisticsDates, mealStatisticsDate } from '../../shared/domain/profile-statistics'
import { configureProfileCalories, recordProfileWeight } from '../../shared/domain/profile-calorie-history'
import { createUuid } from '../../shared/domain/sync'
import type { Profile, MealLog } from '../../shared/domain/types'

const profile = (): Profile => ({ id: 7, uuid: createUuid(), name: 'Anna', dailyCaloriesTarget: 9999, dailyProteinTarget: null, dailyCarbsTarget: null, dailyFatTarget: null, dailySugarTarget: null, dailyFiberTarget: null, dailySaltTarget: null, createdAt: '', updatedAt: null })
const meal = (profileId: number, calories = 100): MealLog => ({ id: 1, loggedAt: '2026-10-10 12:00:00', foodId: 1, recipeId: null, totalWeightGrams: 100, sourceName: 'Food', sourceType: 'food', createdAt: '', updatedAt: null, profiles: [{ id: 1, mealLogId: 1, profileId, profileName: 'Anna', portionFactor: 1, portionGrams: 100 }], nutritionPer100g: { calories, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 } })
it('sorts accents/case/ß consistently without mutation and uses UUID rather than local alias for ties', () => {
  const rows = [{ id: 9,uuid: 'b', name: 'Änne' },{ id: 1,uuid: 'z', name: 'Zoe' },{ id: 2,uuid: 'a', name: 'anne' },{ id: 4,uuid: 'c', name: 'Ömer' },{ id: 5,uuid: 'd', name: 'Straße' },{ id: 3,uuid: 'e', name: 'STRASSE' }]
  expect(sortProfiles(rows).map(row => row.uuid)).toEqual(['a','b','c','d','e','z'])
  expect(sortProfiles(rows.map(row => ({ ...row,id: 100-row.id }))).map(row => row.uuid)).toEqual(['a','b','c','d','e','z'])
  expect(rows[0]!.name).toBe('Änne')
})
it('does not fabricate legacy goals or zero intake; recorded zero remains a real observation', () => {
  const p = profile(), report = buildProfileStatistics(p,[meal(p.id,0),meal(8)],[],'2026-10-09','2026-10-11')
  expect(report.days.map(row => row.intakeKcal)).toEqual([null,0,null])
  expect(report.days.every(row => row.targetKcal === null && row.budgetKcal === null && row.weightKg === null)).toBe(true)
  expect(report.summary).toMatchObject({ intakeDays: 1, targetDays: 0, measurements: 0, meanIntakeKcal: 0, meanTargetKcal: null })
})
it('uses immutable dated goals, observation dates, profile portions and additive activity snapshots', () => {
  const p = profile(), context = { profileId: p.uuid!,today: '2026-10-10',manualTargetKcal: 1900,history: [] }, stamp = { createdAt: '2026-10-10T12:00:00.000Z' }
  const first = configureProfileCalories(context,{ mode: 'automatic',measuredOn: context.today,model: { weightKg: 70,sleepHoursPerDay: 8,workHoursPerWeek: 0,workKind: 'none',sports: [],deficit: { mode: 'absolute',value: 0 } } },stamp)
  const manual = configureProfileCalories({ ...context,today: '2026-10-11',history: [first] },{ mode: 'manual' },stamp)
  const oldWeight = recordProfileWeight({ ...context,today: '2026-10-12',history: [first,manual] },{ weightKg: 60, measuredOn: '2026-10-09' },stamp)
  p.calorieHistory = [oldWeight,first,manual]
  const original = JSON.stringify(p)
  const result = buildProfileStatistics(p,[meal(p.id),meal(8)], [{ id: 1,profileId: p.id,date: '2026-10-10',name: 'Walk',calories: 100,durationMinutes: 30,units: 0.5,createdAt: '',updatedAt: null }],'2026-10-09','2026-10-12')
  expect(result.days.map(day => day.targetKcal)).toEqual([null,2016,1900,1900])
  expect(result.days.map(day => day.weightKg)).toEqual([60,70,null,null])
  expect(result.days[1]).toMatchObject({ needKcal: 2016,budgetKcal: 2066,bonusKcal: 50,intakeKcal: 100,mealCount: 1 })
  expect(result.days[2]!.needKcal).toBeNull()
  expect(JSON.stringify(p)).toBe(original)
})
it('validates calendar range and normalizes meal offset/legacy dates like both adapters', () => {
  expect(statisticsDates('2024-01-01','2024-12-31')).toHaveLength(366)
  for (const [from,to] of [['2026-02-30','2026-03-01'],['2026-10-11','2026-10-10'],['2024-01-01','2025-01-01']]) expect(() => statisticsDates(from!,to!)).toThrow('statisticsRange')
  expect(mealStatisticsDate('2026-10-10T00:30:00+02:00')).toBe('2026-10-09')
  expect(mealStatisticsDate('2026-10-10 12:00:00')).toBe('2026-10-10')
})
