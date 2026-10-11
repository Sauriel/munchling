import { assertNumber,fail } from './validation'

/** Explicitly approximate household model, NOT an extracted TK algorithm. */
export const calorieModelVersion = 'met-household-v1'
export const calorieFactors = {
  sleep: { met: 1,source: 'https://pacompendium.com/inactivity/',code: '07030',kind: 'reference' },
  seated: { met: 1.5,source: 'https://pacompendium.com/occupation/',code: '11580',kind: 'reference-category' },
  standing: { met: 1.8,source: 'https://pacompendium.com/occupation/',code: '11600',kind: 'reference-category' },
  physical: { met: 4.5,source: 'https://pacompendium.com/occupation/',code: '11476',kind: 'reference-category' },
  rest: { met: 1.3,source: null,code: null,kind: 'assumption' },
  gentle: { met: 3,source: null,code: null,kind: 'assumption' },
  moderate: { met: 5,source: null,code: null,kind: 'assumption' },
  intense: { met: 8,source: null,code: null,kind: 'assumption' },
} as const
export type CalorieModelInput = {
  weightKg: number; sleepHoursPerDay: number; workHoursPerWeek: number;
  workKind: 'none' | 'seated' | 'standing' | 'physical';
  sports: { intensity: 'gentle' | 'moderate' | 'intense'; hoursPerWeek: number }[];
  deficit: { mode: 'absolute' | 'percent'; value: number };
}
export type CalorieWarning = 'lowTarget' | 'largeDeficit'
// Technical warning triggers, not universal medical safety thresholds. They do
// not replace explicit user consent or imply that a value above them is safe.
export const calorieWarningThresholds = { lowTargetKcal: 1500,largeDeficitPercent: 30 } as const

export function calculateCaloriePlan(input: CalorieModelInput) {
  assertNumber(input.weightKg,'weightKg',true)
  assertNumber(input.sleepHoursPerDay,'sleepHoursPerDay')
  assertNumber(input.workHoursPerWeek,'workHoursPerWeek')
  if (input.sleepHoursPerDay > 24 || input.workHoursPerWeek > 168) fail('invalidNumber','hours')
  if (!['none','seated','standing','physical'].includes(input.workKind)) fail('invalidType','workKind')
  if (input.workKind === 'none' && input.workHoursPerWeek !== 0) fail('invalidSource','workKind')
  if (!Array.isArray(input.sports)) fail('required','sports')
  if (input.sports.length > 3) fail('invalidNumber','sports')
  const kinds = new Set<string>()
  const sports = input.sports.map(row => {
    if (!['gentle','moderate','intense'].includes(row.intensity)) fail('invalidType','intensity')
    if (kinds.has(row.intensity)) fail('duplicate','intensity'); kinds.add(row.intensity)
    assertNumber(row.hoursPerWeek,'hoursPerWeek')
    if (row.hoursPerWeek > 168) fail('invalidNumber','hoursPerWeek')
    return { intensity: row.intensity,hours: row.hoursPerWeek / 7,met: calorieFactors[row.intensity].met }
  })
  const workHours = input.workHoursPerWeek / 7, sportHours = sports.reduce((s,row) => s + row.hours,0)
  const remaining = 24 - input.sleepHoursPerDay - workHours - sportHours
  if (remaining < -1e-9) fail('invalidNumber','dailyHours')
  const restHours = Math.max(0,remaining)
  const workMet = input.workKind === 'none' ? 0 : calorieFactors[input.workKind].met
  const metHours = input.sleepHoursPerDay * calorieFactors.sleep.met + workHours * workMet +
    sports.reduce((s,row) => s + row.hours * row.met,0) + restHours * calorieFactors.rest.met
  const estimatedNeed = input.weightKg * metHours
  assertNumber(estimatedNeed,'estimatedNeed',true)
  if (!input.deficit || !['absolute','percent'].includes(input.deficit.mode)) fail('invalidType','deficit')
  assertNumber(input.deficit.value,'deficit')
  if (input.deficit.mode === 'percent' && input.deficit.value >= 100) fail('invalidNumber','deficit')
  const deficitKcal = input.deficit.mode === 'absolute' ? input.deficit.value : estimatedNeed * input.deficit.value / 100
  const rawTarget = estimatedNeed - deficitKcal, targetKcal = Math.round(rawTarget)
  assertNumber(rawTarget,'targetKcal',true); assertNumber(targetKcal,'targetKcal',true)
  const warnings: CalorieWarning[] = []
  if (targetKcal < calorieWarningThresholds.lowTargetKcal) warnings.push('lowTarget')
  if (deficitKcal / estimatedNeed * 100 > calorieWarningThresholds.largeDeficitPercent) warnings.push('largeDeficit')
  return {
    modelVersion: calorieModelVersion,input: structuredClone(input),factors: structuredClone(calorieFactors),
    estimatedNeedKcal: Math.round(estimatedNeed),targetKcal,warnings,
    breakdown: { sleepHours: input.sleepHoursPerDay,workHours,workMet,sports,restHours,restMet: calorieFactors.rest.met },
  }
}

/** Bonuses are not part of the baseline calculation and are not deduplicated.
 * Caller resolves the correct profile/date before supplying either value. */
export function calorieDayBudget(baseTargetKcal: number,extraActivityKcal: number) {
  assertNumber(baseTargetKcal,'baseTargetKcal',true); assertNumber(extraActivityKcal,'extraActivityKcal')
  const total = baseTargetKcal + extraActivityKcal; assertNumber(total,'totalKcal',true)
  return { baseTargetKcal,extraActivityKcal,totalKcal: total }
}
