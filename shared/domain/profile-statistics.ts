import type { Profile, MealLog } from './types'
import type { ActivityLog } from './activities'
import { activityTotals } from './activities'
import { calculateMealLogProfileNutrition } from './nutrition'
import { validateProfileCalorieHistory } from './profile-calorie-history'

export const statisticsMaxDays = 366
const dayMs = 86400000
function timestamp(date: string) {
  const value = Date.parse(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || new Date(value).toISOString().slice(0,10) !== date) throw new Error('statisticsRange')
  return value
}
export function statisticsDates(from: string, to: string): string[] {
  const start = timestamp(from), end = timestamp(to), count = (end - start) / dayMs + 1
  if (count < 1 || count > statisticsMaxDays) throw new Error('statisticsRange')
  return Array.from({ length: count }, (_, i) => new Date(start + i * dayMs).toISOString().slice(0,10))
}
/** Same UTC day semantics as SQLite date(logged_at) and the web meal filter.
 * Offsetless legacy timestamps are interpreted as UTC, never device timezone. */
export function mealStatisticsDate(text: string) {
  const iso = text.replace(' ', 'T'), normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + 'Z'
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0,10)
}
export type StatisticsDay = {
  date: string; weightKg: number | null; needKcal: number | null;
  targetKcal: number | null; bonusKcal: number; budgetKcal: number | null;
  intakeKcal: number | null; mealCount: number;
}
export function buildProfileStatistics(profile: Profile, meals: readonly MealLog[], activities: readonly ActivityLog[], from: string, to: string) {
  const dates = statisticsDates(from,to), history = profile.calorieHistory ?? []
  if (history.length) {
    if (!profile.uuid) throw new Error('calorieHistoryInvalid')
    validateProfileCalorieHistory(history,profile.uuid)
  }
  const ordered = [...history].sort((a,b) => a.sequence-b.sequence)
  const weights = new Map<string,number>(), intake = new Map<string,{ calories: number; count: number }>(), bonus = new Map<string,number>()
  for (const row of ordered) if (row.measurement) weights.set(row.measurement.measuredOn,row.measurement.weightKg)
  for (const meal of meals) {
    if (!meal.profiles.some(row => row.profileId === profile.id)) continue
    const date = mealStatisticsDate(meal.loggedAt)
    if (date < from || date > to) continue
    const previous = intake.get(date) ?? { calories: 0, count: 0 }
    previous.calories += calculateMealLogProfileNutrition(meal,profile.id).calories
    previous.count++; intake.set(date,previous)
  }
  for (const row of activities) if (row.profileId === profile.id && row.date >= from && row.date <= to) bonus.set(row.date,(bonus.get(row.date) ?? 0) + activityTotals(row,row.units).calories)
  let index = 0, current: typeof ordered[number] | undefined
  const days: StatisticsDay[] = dates.map(date => {
    while (index < ordered.length && ordered[index]!.validFrom <= date) current = ordered[index++]
    const automatic = current?.state.mode === 'automatic', calculation = automatic ? current?.state.calculation : null
    const targetKcal = current ? automatic ? calculation!.targetKcal : current.state.manualTargetKcal : null
    const bonusKcal = Math.round((bonus.get(date) ?? 0) * 100) / 100
    const recorded = intake.get(date)
    return { date, weightKg: weights.get(date) ?? null, needKcal: calculation?.estimatedNeedKcal ?? null, targetKcal, bonusKcal,
      budgetKcal: targetKcal === null ? null : targetKcal + bonusKcal, intakeKcal: recorded ? Math.round(recorded.calories) : null, mealCount: recorded?.count ?? 0 }
  })
  const known = (field: 'targetKcal' | 'intakeKcal' | 'weightKg') => days.flatMap(day => day[field] === null ? [] : [day[field]!])
  const targets = known('targetKcal'), intakes = known('intakeKcal'), measured = known('weightKg')
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum,value) => sum+value,0)/values.length) : null
  return { days, summary: { days: days.length, intakeDays: intakes.length, targetDays: targets.length, measurements: measured.length,
    meanIntakeKcal: average(intakes), meanTargetKcal: average(targets), firstWeightKg: measured[0] ?? null, lastWeightKg: measured.at(-1) ?? null } }
}
