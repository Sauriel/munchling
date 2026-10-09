import { assertDateTime, assertId, assertNumber, assertRecord, assertText, fail } from './validation'

export type ActivityInput = { name: string; durationMinutes: number; calories: number }
export type Activity = ActivityInput & { id: number; revision?: number; createdAt: string; updatedAt: string | null }
// Copy per-unit values at entry time. No template FK: editing/deleting a
// template must not retroactively change historical allowances.
export type ActivityLog = ActivityInput & { id: number; revision?: number; profileId: number; date: string; units: number; createdAt: string; updatedAt: string | null }
export type ActivityLogInput = { activityId: number; activityRevision?: number; date: string; profiles: { profileId: number; units: number }[] }
export function validateActivity(input: unknown): asserts input is ActivityInput {
  assertRecord(input); assertText(input.name, 'name', true)
  assertNumber(input.durationMinutes, 'durationMinutes', true); assertNumber(input.calories, 'calories')
}
export function validateActivityDate(date: unknown): asserts date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('invalidDate', 'date')
  assertDateTime(`${date}T00:00`, 'date')
}
export function validateActivityLog(input: unknown): asserts input is ActivityLogInput {
  assertRecord(input); assertId(input.activityId, 'activityId'); validateActivityDate(input.date)
  if (!Array.isArray(input.profiles) || !input.profiles.length) fail('required', 'profiles')
  const seen = new Set<number>()
  for (const row of input.profiles) {
    assertRecord(row); assertId(row.profileId, 'profileId'); assertNumber(row.units, 'units', true)
    if (seen.has(row.profileId)) fail('duplicate', 'profileId'); seen.add(row.profileId)
  }
}
export function activityTotals(activity: ActivityInput, units: number) {
  validateActivity(activity); assertNumber(units, 'units', true)
  const durationMinutes = Math.round(activity.durationMinutes * units * 100) / 100
  const calories = Math.round(activity.calories * units * 100) / 100
  assertNumber(durationMinutes, 'durationMinutes', true); assertNumber(calories, 'calories')
  return { durationMinutes, calories }
}
export function activityBonus(logs: ActivityLog[], profileId: number, date: string) {
  return Math.round(logs.filter(log => log.profileId === profileId && log.date === date).reduce((sum, log) => sum + activityTotals(log, log.units).calories, 0) * 100) / 100
}
