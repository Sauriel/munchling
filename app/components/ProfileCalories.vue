<template>
  <details class="mt-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-700" @toggle="opened">
    <summary class="min-h-11 cursor-pointer font-semibold">{{ text.title }} · {{ currentTarget }} kcal</summary>
    <fieldset :disabled="busy" class="mt-3 min-w-0 space-y-3">
      <p class="text-sm">{{ text.additive }}</p>
      <p class="text-xs text-slate-500">{{ text.estimate }}</p>
      <form class="space-y-3" @submit.prevent="saveSettings">
        <label class="flex min-h-11 items-center gap-2"><input v-model="auto" type="checkbox" @change="changed">{{ text.automatic }}</label>
        <p class="text-xs">{{ text.manual }}: {{ base.dailyCaloriesTarget }} kcal</p>
        <div v-if="auto" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>{{ text.weight }}<input v-model.number="weight" required type="number" min="0.1" step="any" class="calorie-input" @input="changed"></label>
          <label>{{ text.measured }}<input v-model="measuredOn" required type="date" :max="today" class="calorie-input" @input="changed"></label>
          <label>{{ text.sleep }}<input v-model.number="sleep" required type="number" min="0" max="24" step="any" class="calorie-input" @input="changed"></label>
          <label>{{ text.workHours }}<input v-model.number="workHours" required type="number" min="0" max="168" step="any" class="calorie-input" @input="changed"></label>
          <label>{{ text.work }}<select v-model="workKind" required class="calorie-input" @change="changed"><option value="" disabled>{{ text.choose }}</option><option value="none">{{ text.none }}</option><option value="seated">{{ text.seated }}</option><option value="standing">{{ text.standing }}</option><option value="physical">{{ text.physical }}</option></select></label>
          <label>{{ text.sport }}<select v-model="sportMode" required class="calorie-input" @change="changed"><option value="" disabled>{{ text.choose }}</option><option value="none">{{ text.none }}</option><option value="yes">{{ text.yes }}</option></select></label>
          <template v-if="sportMode === 'yes'">
            <label v-for="kind in intensities" :key="kind">{{ text[kind] }} ({{ text.week }})<input v-model.number="sports[kind]" required type="number" min="0" max="168" step="any" class="calorie-input" @input="changed"></label>
          </template>
          <label>{{ text.deficit }}<select v-model="deficitMode" class="calorie-input" @change="changed"><option value="absolute">kcal / {{ text.day }}</option><option value="percent">%</option></select></label>
          <label>{{ text.deficitValue }}<input v-model.number="deficit" required type="number" min="0" step="any" class="calorie-input" @input="changed"></label>
        </div>
        <div v-if="auto && preview" class="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950">
          <p>{{ text.need }}: <strong>{{ preview.estimatedNeedKcal }} kcal</strong></p>
          <p>{{ text.target }}: <strong>{{ preview.targetKcal }} kcal</strong></p>
          <p>{{ text.rest }}: {{ preview.breakdown.restHours.toFixed(2) }} h · 1.3 MET</p>
          <p>{{ text.factors }}</p>
          <label v-if="preview.warnings.length" class="mt-3 flex items-start gap-2 text-amber-800 dark:text-amber-300"><input type="checkbox" :checked="!!confirmation" @change="confirmPreview">{{ text.warning }}</label>
        </div>
        <p v-else-if="auto" class="text-sm text-amber-800 dark:text-amber-300">{{ text.incomplete }}</p>
        <button class="min-h-11 rounded-xl bg-munchling-600 px-4 font-semibold text-white disabled:opacity-50" :disabled="busy || auto && (!preview || !!preview.warnings.length && !confirmation)">{{ text.save }}</button>
      </form>
      <form class="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700" @submit.prevent="saveWeight">
        <h3 class="font-semibold">{{ text.recordWeight }}</h3>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2"><label>{{ text.weight }}<input v-model.number="newWeight" required type="number" min="0.1" step="any" class="calorie-input" @input="dirty = true; weightConfirmation = undefined"></label><label>{{ text.measured }}<input v-model="newWeightDate" required type="date" :max="today" class="calorie-input" @input="dirty = true; weightConfirmation = undefined"></label></div>
        <label v-if="weightPreview?.warnings.length" class="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300"><input type="checkbox" :checked="!!weightConfirmation" @change="confirmWeight">{{ text.warning }} ({{ weightPreview.targetKcal }} kcal)</label>
        <button class="min-h-11 rounded-xl bg-slate-100 px-4 font-semibold dark:bg-slate-800" :disabled="busy || !!weightPreview?.warnings.length && !weightConfirmation">{{ text.recordWeight }}</button>
      </form>
      <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <ProfileCalorieHistory :profile="profile" />
    </fieldset>
  </details>
</template>
<script setup lang="ts">
import type { Profile } from '../../shared/domain/types'
import { calculateCaloriePlan,type CalorieModelInput } from '../../shared/domain/calorie-model'
import { profileGoalAt,profileWeightAt,confirmCalorieCalculation,type CalorieWarningConfirmation } from '../../shared/domain/profile-calorie-history'
import { localCalendarDate,type ProfileCalorieChange } from '../../shared/domain/profile-calorie-command'
import { validationMessage } from '../../shared/domain/validation'
const props = defineProps<{ profile: Profile }>()
const { locale,t } = useI18n()
const { updateProfile,refreshProfiles } = useProfiles()
const today = localCalendarDate(), busy = ref(false), error = ref(''), dirty = ref(false)
const base = shallowRef<Profile>(structuredClone(toRaw(props.profile)))
const auto = ref(false), weight = ref<number | null>(null), sleep = ref<number | null>(null), workHours = ref<number | null>(null)
const workKind = ref<CalorieModelInput['workKind'] | ''>(''), sportMode = ref(''), deficitMode = ref<'absolute' | 'percent'>('absolute'), deficit = ref(0)
const measuredOn = ref(today), newWeightDate = ref(today), newWeight = ref<number | null>(null)
const intensities = ['gentle','moderate','intense'] as const
const sports = reactive<Record<typeof intensities[number],number | null>>({ gentle: null,moderate: null,intense: null })
const confirmation = ref<CalorieWarningConfirmation>(), weightConfirmation = ref<CalorieWarningConfirmation>()
const words = {
  de: { title: 'Kalorienberechnung & Verlauf',additive: 'Tagesbudget = datiertes Grundziel + zusätzlich gebuchte Bewegung. Diese Bewegung darf nicht bereits im Alltagsprofil enthalten sein.',estimate: 'MET-Schätzung, keine Messung oder exakte TK-Kopie. Für Kinder, Erkrankungen oder besondere Lebenssituationen möglicherweise ungeeignet.',automatic: 'Automatische Berechnung für dieses Profil',manual: 'Separat gespeichertes manuelles Ziel (im Profileditor änderbar)',weight: 'Gewicht (kg)',measured: 'Messdatum',sleep: 'Schlaf (h/Tag)',workHours: 'Arbeit (h/Woche, z. B. 40 → 40/7 täglich)',work: 'Arbeitsart',choose: 'Bitte ausdrücklich wählen',none: 'Keine',seated: 'Sitzend, leicht (1.5 MET)',standing: 'Stehend, leicht (1.8 MET)',physical: 'Körperlich, moderat (4.5 MET)',sport: 'Regelmäßiger Sport im Alltagsprofil',yes: 'Ja – Wochenstunden je Intensität angeben',gentle: 'Leicht (3 MET)',moderate: 'Moderat (5 MET)',intense: 'Intensiv (8 MET)',week: 'h/Woche; 0 ausdrücklich möglich',deficit: 'Defizitmodus',day: 'Tag',deficitValue: 'Defizit (Startwert 0)',need: 'Geschätzter Bedarf',target: 'Grundziel nach Defizit',rest: 'Abgeleitete Restzeit',factors: '1 MET ≈ 1 kcal/kg/h; Schlaf: 1.0 MET. Restzeit und Sport-MET sind Modellannahmen. Arbeit/Schlaf: Compendium-Kategorien, keine individuellen Messwerte.',warning: 'Auffällig niedriges Ziel (<1500 kcal) oder großes Defizit (>30 %). Keine medizinische Sicherheitsgrenze. Ich bestätige diese konkreten Werte ausdrücklich.',incomplete: 'Alle persönlichen Angaben sind erforderlich; die Zeiten müssen in einen 24-h-Durchschnittstag passen.',save: 'Berechnung / Modus speichern (ab heute)',recordWeight: 'Gewicht mit Datum erfassen',failed: 'Aktion nicht abschließend bestätigt. Bitte Schreibstatus und Profilstand prüfen; bei Tageswechsel die Seite neu laden.' },
  en: { title: 'Calorie calculation & history',additive: 'Daily budget = dated baseline target + additionally booked movement. Do not book movement already included in the baseline.',estimate: 'MET estimate, not a measurement or exact TK copy. May not suit children, illnesses or special circumstances.',automatic: 'Automatic calculation for this profile',manual: 'Separately retained manual target (editable in the profile editor)',weight: 'Weight (kg)',measured: 'Measurement date',sleep: 'Sleep (h/day)',workHours: 'Work (h/week, e.g. 40 → 40/7 daily)',work: 'Work category',choose: 'Choose explicitly',none: 'None',seated: 'Seated, light (1.5 MET)',standing: 'Standing, light (1.8 MET)',physical: 'Physical, moderate (4.5 MET)',sport: 'Regular sport in baseline',yes: 'Yes – enter hours per intensity',gentle: 'Gentle (3 MET)',moderate: 'Moderate (5 MET)',intense: 'Intense (8 MET)',week: 'h/week; explicit 0 allowed',deficit: 'Deficit mode',day: 'day',deficitValue: 'Deficit (initially 0)',need: 'Estimated need',target: 'Baseline target after deficit',rest: 'Derived remaining time',factors: '1 MET ≈ 1 kcal/kg/h; sleep: 1.0 MET. Remaining time and sport METs are assumptions. Work/sleep: Compendium categories, not individual measurements.',warning: 'Unusually low target (<1500 kcal) or large deficit (>30%). Not a medical safety boundary. I explicitly confirm these exact values.',incomplete: 'All personal inputs are required; durations must fit a 24-hour average day.',save: 'Save calculation / mode (from today)',recordWeight: 'Record dated weight',failed: 'Action not conclusively confirmed. Check write status and profile version; reload the page after a date change.' }
}
const text = computed(() => locale.value.startsWith('de') ? words.de : words.en)
const currentTarget = computed(() => props.profile.uuid ? profileGoalAt(props.profile.calorieHistory ?? [],props.profile.uuid,today)?.targetKcal ?? props.profile.dailyCaloriesTarget : props.profile.dailyCaloriesTarget)
function load() {
  base.value = structuredClone(toRaw(props.profile))
  const p = base.value, state = p.uuid ? profileGoalAt(p.calorieHistory ?? [],p.uuid,today)?.state : null, knownWeight = p.uuid ? profileWeightAt(p.calorieHistory ?? [],p.uuid,today) : null
  auto.value = state?.mode === 'automatic'
  const input = state?.calculation?.input
  weight.value = knownWeight?.weightKg ?? input?.weightKg ?? null; measuredOn.value = knownWeight?.measuredOn ?? today
  sleep.value = input?.sleepHoursPerDay ?? null; workHours.value = input?.workHoursPerWeek ?? null; workKind.value = input?.workKind ?? ''
  sportMode.value = input ? input.sports.length ? 'yes' : 'none' : ''
  for (const kind of intensities) sports[kind] = input ? input.sports.find(row => row.intensity === kind)?.hoursPerWeek ?? 0 : null
  deficitMode.value = input?.deficit.mode ?? 'absolute'; deficit.value = input?.deficit.value ?? 0
  confirmation.value = undefined; weightConfirmation.value = undefined; dirty.value = false
}
function opened(event: Event) { if ((event.target as HTMLDetailsElement).open && !dirty.value) load() }
function changed() { dirty.value = true; confirmation.value = undefined }
function model(): CalorieModelInput {
  if (!workKind.value || !sportMode.value || weight.value === null || sleep.value === null || workHours.value === null) throw new Error('required')
  const rows = sportMode.value === 'none' ? [] : intensities.map(intensity => { if (sports[intensity] === null) throw new Error('required'); return { intensity,hoursPerWeek: sports[intensity]! } })
  return { weightKg: weight.value,sleepHoursPerDay: sleep.value,workHoursPerWeek: workHours.value,workKind: workKind.value,sports: rows,deficit: { mode: deficitMode.value,value: deficit.value } }
}
const preview = computed(() => { try { return calculateCaloriePlan(model()) } catch { return null } })
const weightPreview = computed(() => {
  try {
    const p = base.value, state = p.uuid ? profileGoalAt(p.calorieHistory ?? [],p.uuid,today)?.state : null
    if (!p.uuid || state?.mode !== 'automatic' || newWeight.value === null) return null
    const latest = profileWeightAt(p.calorieHistory ?? [],p.uuid,today)
    if (latest && newWeightDate.value < latest.measuredOn) return null
    return calculateCaloriePlan({ ...state.calculation!.input,weightKg: newWeight.value })
  } catch { return null }
})
function confirmPreview(event: Event) { confirmation.value = (event.target as HTMLInputElement).checked && preview.value && base.value.uuid ? confirmCalorieCalculation(base.value.uuid,today,preview.value) : undefined }
function confirmWeight(event: Event) { weightConfirmation.value = (event.target as HTMLInputElement).checked && weightPreview.value && base.value.uuid ? confirmCalorieCalculation(base.value.uuid,today,weightPreview.value) : undefined }
async function save(change: ProfileCalorieChange) {
  busy.value = true; error.value = ''
  try {
    await updateProfile(base.value.id,{ calorieDate: today,calorieChange: change },base.value.revision)
    dirty.value = false; await refreshProfiles(); await nextTick(); load()
  } catch (cause) {
    const message = validationMessage(cause,t)
    error.value = text.value.failed + (message === t('validation.failed') ? '' : ` ${message}`)
  }
  finally { busy.value = false }
}
async function saveSettings() { try { await save(auto.value ? { kind: 'configure',mode: 'automatic',model: model(),measuredOn: measuredOn.value,confirmation: confirmation.value } : { kind: 'configure',mode: 'manual' }) } catch { error.value = text.value.incomplete } }
async function saveWeight() { if (typeof newWeight.value !== 'number') return; await save({ kind: 'weight',weightKg: newWeight.value,measuredOn: newWeightDate.value,confirmation: weightConfirmation.value }) }
watch(() => props.profile,() => { if (!dirty.value && !busy.value) load() })
load()
</script>
<style scoped>
.calorie-input { display: block; width: 100%; min-width: 0; min-height: 44px; margin-top: 4px; border: 1px solid #94a3b8; border-radius: 10px; padding: 8px; background: transparent; }
</style>
