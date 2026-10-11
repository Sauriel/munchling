import { configureProfileCalories,recordManualCalorieTarget,recordProfileWeight,type ProfileCalorieEvent,type CalorieWarningConfirmation } from './profile-calorie-history'
import type { CalorieModelInput } from './calorie-model'
import { validateActivityDate } from './activities'
export type ProfileCalorieChange =
  | { kind: 'configure'; mode: 'manual' | 'automatic'; model?: CalorieModelInput; measuredOn?: string; confirmation?: CalorieWarningConfirmation }
  | { kind: 'weight'; weightKg: number; measuredOn: string; confirmation?: CalorieWarningConfirmation }
export function localCalendarDate(date = new Date()) {
  return `${date.getFullYear().toString().padStart(4,'0')}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`
}
/** Shared command planner. Caller owns a single guarded profile transaction. */
export function planProfileCalorieEvents(profileId: string,history: readonly ProfileCalorieEvent[],previousManual: number,nextManual: number,date: string,change?: ProfileCalorieChange,initialize = false) {
  validateActivityDate(date)
  if (date !== localCalendarDate()) throw new Error('calorieDateChanged')
  const entries: ProfileCalorieEvent[] = []
  const context = () => ({ profileId,history: [...history,...entries],manualTargetKcal: nextManual,today: date })
  if (previousManual !== nextManual || initialize && history.length === 0 && !change) entries.push(recordManualCalorieTarget({ ...context(),manualTargetKcal: previousManual },nextManual))
  if (change?.kind === 'configure') entries.push(configureProfileCalories(context(),change))
  else if (change?.kind === 'weight') entries.push(recordProfileWeight(context(),change))
  else if (change) throw new Error('invalidCalorieChange')
  return entries
}
