import { calculateCaloriePlan } from './calorie-model'
import { assertProfileCalorieAppendOnly,profileWeightAt,sameProfileCalorieValue,validateProfileCalorieHistory,type ProfileCalorieEvent,type ProfileCalorieState } from './profile-calorie-history'
import { assertRecord,assertText,assertNumber,fail } from './validation'

export const profileCalorieWireColumns = ['profile_id','sequence','valid_from','created_at','event_json'] as const
export type ProfileCalorieWireRow = { id: string; profile_id: string; sequence: number; valid_from: string; created_at: string; event_json: string }
/** Strict, non-mutating codec. Keep event_json bytes: they belong to original
 * request hashes, archived calculations and accepted immutable children. */
export function decodeProfileCalorieRows(input: unknown,profileId: string): ProfileCalorieEvent[] {
  if (!Array.isArray(input) || input.length > 100_000) fail('backupLimit','calorie_history')
  const rows: ProfileCalorieEvent[] = input.map(value => {
    assertRecord(value,'calorie_history'); const allowed = ['id',...profileCalorieWireColumns]
    if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) fail('invalidType','calorie_history')
    assertText(value.id,'id'); assertText(value.profile_id,'profile_id'); assertNumber(value.sequence,'sequence')
    assertText(value.valid_from,'valid_from'); assertText(value.created_at,'created_at'); assertText(value.event_json,'event_json',true)
    if (new TextEncoder().encode(value.event_json).byteLength > 64 * 1024) fail('backupLimit','event_json')
    let body: unknown; try { body = JSON.parse(value.event_json) } catch { fail('invalidType','event_json') }
    assertRecord(body,'event_json')
    if (Object.keys(body).sort().join(',') !== 'kind,measurement,state') fail('invalidType','event_json')
    return { id: value.id,profileId: value.profile_id,sequence: value.sequence,validFrom: value.valid_from,createdAt: value.created_at,kind: body.kind,measurement: body.measurement,state: body.state } as ProfileCalorieEvent
  })
  validateProfileCalorieHistory(rows,profileId)
  return rows
}
export function encodeProfileCalorieEvent(event: ProfileCalorieEvent): ProfileCalorieWireRow {
  validateProfileCalorieHistory([event],event.profileId)
  return { id: event.id,profile_id: event.profileId,sequence: event.sequence,valid_from: event.validFrom,created_at: event.createdAt,event_json: JSON.stringify({ kind: event.kind,measurement: event.measurement,state: event.state }) }
}
/** Previous rows come from the authoritative locked DB cut, NOT from a draft.
 * Retained historical versions are never re-run through the current model.
 * Only newly appended automatic calculations may claim today's model. */
export function verifyProfileCalorieWrite(previousRows: unknown,nextRows: unknown,profileId: string,previousManualTargetKcal: number,nextManualTargetKcal: number) {
  const previous = decodeProfileCalorieRows(previousRows,profileId), next = decodeProfileCalorieRows(nextRows,profileId)
  assertProfileCalorieAppendOnly(previous,next,profileId)
  assertNumber(previousManualTargetKcal,'manualTargetKcal'); assertNumber(nextManualTargetKcal,'manualTargetKcal')
  if (!Number.isSafeInteger(previousManualTargetKcal) || !Number.isSafeInteger(nextManualTargetKcal)) fail('invalidNumber','manualTargetKcal')
  const previousWire = new Map((previousRows as ProfileCalorieWireRow[]).map(row => [row.id,row]))
  for (const row of nextRows as ProfileCalorieWireRow[]) {
    const old = previousWire.get(row.id)
    if (old && !sameProfileCalorieValue(old,row)) fail('historyImmutable','calorie_history')
  }
  const knownIds = new Set(previous.map(row => row.id)), ordered = [...previous].sort((a,b) => a.sequence - b.sequence)
  const known = [...previous]
  let state: ProfileCalorieState = ordered.at(-1)?.state ?? { mode: 'manual',manualTargetKcal: previousManualTargetKcal,calculation: null }
  let sequence = ordered.at(-1)?.sequence ?? 0
  for (const event of next.filter(row => !knownIds.has(row.id)).sort((a,b) => a.sequence - b.sequence)) {
    if (event.sequence !== ++sequence) fail('invalidNumber','sequence')
    const calculation = event.state.calculation
    if (event.state.mode === 'manual' && event.kind !== 'weight' && event.state.manualTargetKcal <= 0) fail('invalidNumber','manualTargetKcal')
    if (event.kind === 'settings') {
      if (event.state.mode === 'automatic') {
        if (!calculation || !event.measurement || event.measurement.weightKg !== calculation.input.weightKg) fail('reference','measurement')
        const currentWeight = profileWeightAt(known,profileId,event.validFrom)
        if (currentWeight && event.measurement.measuredOn < currentWeight.measuredOn) fail('invalidDate','measuredOn')
        if (!sameProfileCalorieValue(calculation,calculateCaloriePlan(calculation.input))) fail('invalidType','calculation')
      } else if (!sameProfileCalorieValue(calculation,state.calculation) || event.measurement !== null) fail('invalidType','calculation')
    } else {
      if (event.state.mode !== state.mode) fail('invalidType','mode')
      if (event.kind === 'manualTarget') {
        if (event.measurement !== null || !sameProfileCalorieValue(calculation,state.calculation)) fail('invalidType','calculation')
      } else {
        if (!event.measurement || event.state.manualTargetKcal !== state.manualTargetKcal) fail('invalidType','measurement')
        const currentWeight = profileWeightAt(known,profileId,event.validFrom)
        const becomesCurrent = !currentWeight || event.measurement.measuredOn >= currentWeight.measuredOn
        const expected = state.mode === 'automatic' && becomesCurrent ? calculateCaloriePlan({ ...state.calculation!.input,weightKg: event.measurement.weightKg }) : state.calculation
        if (!sameProfileCalorieValue(calculation,expected)) fail('invalidType','calculation')
      }
    }
    state = event.state; known.push(event)
  }
  // Legacy unchanged name/nutrient edits can retain existing history. A new
  // manual value must have a new dated event, never alter just the live scalar.
  if (next.length && state.manualTargetKcal !== nextManualTargetKcal) fail('reference','manualTargetKcal')
  return next
}
