import { calculateCaloriePlan,type CalorieModelInput } from './calorie-model'
import { validateActivityDate } from './activities'
import { createUuid,isUuid } from './sync'
import { assertNumber,assertDateTime,assertRecord,assertText,fail } from './validation'

export type CalorieCalculation = ReturnType<typeof calculateCaloriePlan>
export type ProfileCalorieState = {
  mode: 'manual' | 'automatic'; manualTargetKcal: number;
  /** Retained when disabling automation, without changing the manual target. */
  calculation: CalorieCalculation | null;
}
export type ProfileCalorieEvent = {
  id: string; profileId: string; sequence: number; validFrom: string; createdAt: string;
  kind: 'settings' | 'weight' | 'manualTarget';
  measurement: { weightKg: number; measuredOn: string } | null;
  state: ProfileCalorieState;
}
export type CalorieHistoryContext = {
  profileId: string; today: string; manualTargetKcal: number;
  history: readonly ProfileCalorieEvent[];
}
export type CalorieWarningConfirmation = { profileId: string; date: string; calculation: CalorieCalculation }
type Stamp = { id?: string; createdAt?: string }
const maxSequence = (history: readonly ProfileCalorieEvent[]) => history.reduce((maximum,row) => Math.max(maximum,row.sequence),0)
/** Create only on explicit UI confirmation; never use an enduring boolean. */
export function confirmCalorieCalculation(profileId: string,date: string,calculation: CalorieCalculation): CalorieWarningConfirmation {
  identity(profileId); day(date)
  return { profileId,date,calculation: structuredClone(calculation) }
}
export class ProfileCalorieHistoryError extends Error {
  constructor(public readonly code: 'confirmCalorieWarning' | 'historyImmutable' | 'historyDateConflict' | 'calorieHistoryInvalid') { super(code); this.name = 'ProfileCalorieHistoryError' }
}
function identity(value: string) { if (!isUuid(value)) fail('invalidType','uuid') }
function day(value: string) { validateActivityDate(value) }
function manualTarget(value: number) {
  assertNumber(value,'manualTargetKcal')
  if (!Number.isSafeInteger(value)) fail('invalidNumber','manualTargetKcal')
}
// Structural check only: stored versions/factors/results are facts, never
// recalculated using today's model. Wire/new-write verification is separate.
function storedCalculation(calculation: CalorieCalculation) {
  assertRecord(calculation,'calculation'); assertText(calculation.modelVersion,'modelVersion',true)
  assertNumber(calculation.targetKcal,'targetKcal',true); assertNumber(calculation.estimatedNeedKcal,'estimatedNeedKcal',true)
  if (!Number.isSafeInteger(calculation.targetKcal) || !Number.isSafeInteger(calculation.estimatedNeedKcal)) fail('invalidNumber','calculation')
  assertRecord(calculation.input,'modelInput')
  assertNumber(calculation.input.weightKg,'weightKg',true)
  assertNumber(calculation.input.sleepHoursPerDay,'sleepHoursPerDay'); assertNumber(calculation.input.workHoursPerWeek,'workHoursPerWeek')
  assertText(calculation.input.workKind,'workKind',true)
  assertRecord(calculation.input.deficit,'deficit'); assertText(calculation.input.deficit.mode,'deficitMode',true); assertNumber(calculation.input.deficit.value,'deficit')
  if (!Array.isArray(calculation.input.sports)) fail('invalidType','sports')
  for (const row of calculation.input.sports) { assertRecord(row,'sport'); assertText(row.intensity,'intensity',true); assertNumber(row.hoursPerWeek,'hoursPerWeek') }
  assertRecord(calculation.factors,'factors')
  for (const name of ['sleep','seated','standing','physical','rest','gentle','moderate','intense'] as const) {
    const factor = calculation.factors[name]; assertRecord(factor,'factor'); assertNumber(factor.met,'met',true); assertText(factor.kind,'factorKind',true)
    if (factor.source !== null) assertText(factor.source,'factorSource',true)
    if (factor.code !== null) assertText(factor.code,'factorCode',true)
  }
  assertRecord(calculation.breakdown,'breakdown')
  for (const field of ['sleepHours','workHours','workMet','restHours','restMet'] as const) assertNumber(calculation.breakdown[field],field)
  if (!Array.isArray(calculation.breakdown.sports) || !Array.isArray(calculation.warnings)) fail('invalidType','breakdown')
  for (const row of calculation.breakdown.sports) { assertRecord(row,'sportBreakdown'); assertText(row.intensity,'intensity',true); assertNumber(row.hours,'hours'); assertNumber(row.met,'met',true) }
  if (calculation.warnings.some(code => !['lowTarget','largeDeficit'].includes(code))) fail('invalidType','warnings')
}
function stamp(input: Stamp) {
  const id = input.id ?? createUuid(), createdAt = input.createdAt ?? new Date().toISOString()
  identity(id); assertDateTime(createdAt,'createdAt')
  // Canonical UTC milliseconds roundtrip exactly through MariaDB DATETIME(3).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || Number(createdAt.slice(0,4)) < 1000) fail('invalidDate','createdAt')
  return { id,createdAt }
}
function same(a: unknown,b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => same(v,b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const first = a as Record<string,unknown>, second = b as Record<string,unknown>, keys = Object.keys(first)
  return keys.length === Object.keys(second).length && keys.every(k => Object.hasOwn(second,k) && same(first[k],second[k]))
}
/** Order-independent JSON value comparison, including frozen model snapshots. */
export const sameProfileCalorieValue = (a: unknown,b: unknown) => same(a,b)
/** Do not recompute stored past calculations with the current factor set. */
export function validateProfileCalorieHistory(history: readonly ProfileCalorieEvent[], profileId: string) {
  identity(profileId)
  if (!Array.isArray(history) || history.length > 100_000) throw new ProfileCalorieHistoryError('calorieHistoryInvalid')
  const ids = new Set<string>(), sequences = new Set<number>()
  for (const row of history as readonly ProfileCalorieEvent[]) {
    assertRecord(row,'calorieEvent'); assertRecord(row.state,'calorieState')
    identity(row.id); if (row.profileId !== profileId || ids.has(row.id)) throw new ProfileCalorieHistoryError('calorieHistoryInvalid'); ids.add(row.id)
    assertNumber(row.sequence,'sequence',true)
    if (!Number.isSafeInteger(row.sequence) || sequences.has(row.sequence)) throw new ProfileCalorieHistoryError('calorieHistoryInvalid'); sequences.add(row.sequence)
    day(row.validFrom); assertDateTime(row.createdAt,'createdAt'); stamp({ id: row.id,createdAt: row.createdAt })
    if (!['settings','weight','manualTarget'].includes(row.kind) || !['manual','automatic'].includes(row.state.mode)) throw new ProfileCalorieHistoryError('calorieHistoryInvalid')
    manualTarget(row.state.manualTargetKcal) // Legacy manual zero targets remain valid.
    if (row.measurement !== null) {
      assertRecord(row.measurement,'measurement')
      day(row.measurement.measuredOn); assertNumber(row.measurement.weightKg,'weightKg',true)
      if (row.measurement.measuredOn > row.validFrom) throw new ProfileCalorieHistoryError('historyDateConflict')
    }
    if (row.kind === 'weight' && !row.measurement) throw new ProfileCalorieHistoryError('calorieHistoryInvalid')
    const calculation = row.state.calculation
    if (row.state.mode === 'automatic' && !calculation) throw new ProfileCalorieHistoryError('calorieHistoryInvalid')
    if (calculation !== null) storedCalculation(calculation)
  }
  const ordered = [...history].sort((a,b) => a.sequence - b.sequence)
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.validFrom < ordered[i-1]!.validFrom) throw new ProfileCalorieHistoryError('historyDateConflict')
}
/** For SQL/server/receive replacement: accepted children cannot vanish/change.
 * Array order is not identity and may differ between backup/wire projections. */
export function assertProfileCalorieAppendOnly(previous: readonly ProfileCalorieEvent[], next: readonly ProfileCalorieEvent[], profileId: string) {
  validateProfileCalorieHistory(previous,profileId); validateProfileCalorieHistory(next,profileId)
  const byId = new Map(next.map(row => [row.id,row]))
  for (const row of previous) if (!same(row,byId.get(row.id))) throw new ProfileCalorieHistoryError('historyImmutable')
  const known = new Set(previous.map(row => row.id)), maximum = maxSequence(previous)
  const lastDay = previous.reduce((last,row) => row.validFrom > last ? row.validFrom : last,'')
  for (const row of next) if (!known.has(row.id) && (row.sequence <= maximum || row.validFrom < lastDay)) throw new ProfileCalorieHistoryError('historyImmutable')
}
export function profileGoalAt(history: readonly ProfileCalorieEvent[], profileId: string,date: string) {
  day(date); validateProfileCalorieHistory(history,profileId)
  let entry: ProfileCalorieEvent | null = null
  for (const row of history) if (row.validFrom <= date && (!entry || row.sequence > entry.sequence)) entry = row
  if (!entry) return null // Unknown historical goal, never the current manual target.
  let state: ProfileCalorieState
  try { state = JSON.parse(JSON.stringify(entry.state)) as ProfileCalorieState }
  catch { throw new ProfileCalorieHistoryError('calorieHistoryInvalid') }
  return { eventId: entry.id,validFrom: entry.validFrom,state,targetKcal: state.mode === 'automatic' ? state.calculation!.targetKcal : state.manualTargetKcal }
}
export function profileWeightAt(history: readonly ProfileCalorieEvent[], profileId: string,date: string) {
  day(date); validateProfileCalorieHistory(history,profileId)
  let entry: ProfileCalorieEvent | null = null
  for (const row of history) if (row.measurement && row.measurement.measuredOn <= date && (!entry ||
    row.measurement.measuredOn > entry.measurement!.measuredOn || row.measurement.measuredOn === entry.measurement!.measuredOn && row.sequence > entry.sequence)) entry = row
  return entry ? { eventId: entry.id,weightKg: entry.measurement!.weightKg,measuredOn: entry.measurement!.measuredOn } : null
}
function current(context: CalorieHistoryContext): ProfileCalorieState {
  identity(context.profileId); day(context.today); manualTarget(context.manualTargetKcal)
  const selected = profileGoalAt(context.history,context.profileId,context.today)
  if (context.history.some(row => row.validFrom > context.today)) throw new ProfileCalorieHistoryError('historyDateConflict')
  return selected ? { ...selected.state,manualTargetKcal: context.manualTargetKcal } : { mode: 'manual',manualTargetKcal: context.manualTargetKcal,calculation: null }
}
function append(context: CalorieHistoryContext,state: ProfileCalorieState,kind: ProfileCalorieEvent['kind'],measurement: ProfileCalorieEvent['measurement'],input: Stamp) {
  const entry: ProfileCalorieEvent = { ...stamp(input),profileId: context.profileId,sequence: maxSequence(context.history) + 1,validFrom: context.today,kind,measurement: structuredClone(measurement),state: structuredClone(state) }
  assertProfileCalorieAppendOnly(context.history,[...context.history,entry],context.profileId)
  return entry
}
function checked(context: CalorieHistoryContext,input: CalorieModelInput,confirmation?: CalorieWarningConfirmation) {
  const calculation = calculateCaloriePlan(input)
  if (calculation.warnings.length && (!confirmation || confirmation.profileId !== context.profileId || confirmation.date !== context.today || !same(calculation,confirmation.calculation))) throw new ProfileCalorieHistoryError('confirmCalorieWarning')
  return calculation
}
export function configureProfileCalories(context: CalorieHistoryContext, input: { mode: ProfileCalorieState['mode']; model?: CalorieModelInput; measuredOn?: string; confirmation?: CalorieWarningConfirmation }, timestamp: Stamp = {}) {
  const previous = current(context)
  if (!['manual','automatic'].includes(input.mode)) fail('invalidType','mode')
  if (input.mode === 'manual' && context.manualTargetKcal <= 0) fail('invalidNumber','manualTargetKcal')
  let calculation = previous.calculation, measurement: ProfileCalorieEvent['measurement'] = null
  if (input.mode === 'automatic') {
    if (!input.model) fail('required','model')
    calculation = checked(context,input.model,input.confirmation)
    // An entered weight is a real explicit observation, not inferred personal data.
    if (!input.measuredOn) fail('required','measuredOn'); day(input.measuredOn)
    measurement = { weightKg: input.model.weightKg,measuredOn: input.measuredOn }
    const existing = profileWeightAt(context.history,context.profileId,context.today)
    if (existing && existing.measuredOn > measurement.measuredOn) throw new ProfileCalorieHistoryError('historyDateConflict')
  }
  return append(context,{ mode: input.mode,manualTargetKcal: context.manualTargetKcal,calculation },'settings',measurement,timestamp)
}
export function recordProfileWeight(context: CalorieHistoryContext, input: { weightKg: number; measuredOn: string; confirmation?: CalorieWarningConfirmation }, timestamp: Stamp = {}) {
  const state = current(context); day(input.measuredOn); assertNumber(input.weightKg,'weightKg',true)
  if (input.measuredOn > context.today) throw new ProfileCalorieHistoryError('historyDateConflict')
  const previous = profileWeightAt(context.history,context.profileId,context.today)
  const becomesCurrent = !previous || input.measuredOn >= previous.measuredOn
  if (state.mode === 'automatic' && becomesCurrent) state.calculation = checked(context,{ ...state.calculation!.input,weightKg: input.weightKg },input.confirmation)
  return append(context,state,'weight',{ weightKg: input.weightKg,measuredOn: input.measuredOn },timestamp)
}
export function recordManualCalorieTarget(context: CalorieHistoryContext, value: number, timestamp: Stamp = {}) {
  const state = current(context); manualTarget(value); if (value <= 0) fail('invalidNumber','manualTargetKcal'); state.manualTargetKcal = value
  return append(context,state,'manualTarget',null,timestamp)
}
