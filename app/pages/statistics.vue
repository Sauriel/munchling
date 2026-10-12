<template>
  <main id="main-content" tabindex="-1" class="page-shell statistics-page">
    <header class="statistics-controls space-y-3">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center underline">{{ $t('common.back') }}</NuxtLink>
      <h1 class="text-2xl font-bold">{{ text.title }}</h1>
      <form class="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="load">
        <label class="grid gap-1 text-sm">{{ text.profile }}<select v-model="selectedId" required class="rounded-xl border border-slate-300 bg-white p-3 dark:bg-slate-900"><option value="">{{ text.choose }}</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
        <label class="grid gap-1 text-sm">{{ text.from }}<input v-model="from" required type="date" :max="to" class="rounded-xl border border-slate-300 bg-white p-3 dark:bg-slate-900"></label>
        <label class="grid gap-1 text-sm">{{ text.to }}<input v-model="to" required type="date" :min="from" :max="today" class="rounded-xl border border-slate-300 bg-white p-3 dark:bg-slate-900"></label>
        <button :disabled="loading" class="min-h-11 rounded-xl bg-munchling-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{{ loading ? $t('common.loading') : text.show }}</button>
      </form>
      <p class="text-xs text-slate-500">{{ text.rangeHint }}</p>
      <button v-if="report && !native" :disabled="loading || !matchesFilters" type="button" class="min-h-11 rounded-xl border border-slate-300 px-4 py-2 disabled:opacity-50" @click="printReport">{{ text.print }}</button>
      <p v-if="report && !matchesFilters" role="status" class="text-sm text-amber-700">{{ text.changed }}</p>
    </header>
    <p v-if="error" role="alert" class="rounded-xl border border-red-300 p-4 text-red-700">{{ error }}</p>
    <p v-if="loading" role="status">{{ $t('common.loading') }}</p>
    <article v-if="report && matchesFilters" class="statistics-report space-y-5">
      <header>
        <h1 class="text-2xl font-bold">{{ text.title }} · {{ report.name }}</h1>
        <p>{{ report.from }} – {{ report.to }} · {{ text.created }} {{ report.created }}</p>
      </header>
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ text.disclaimer }}</p>
      <div class="statistics-summary grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <section class="rounded-xl border border-slate-200 p-3"><h2 class="text-sm font-semibold">{{ text.intakeMean }}</h2><p class="text-xl">{{ value(report.data.summary.meanIntakeKcal) }} kcal</p><p class="text-xs">{{ text.recorded }}: {{ report.data.summary.intakeDays }}/{{ report.data.summary.days }} {{ text.days }}</p></section>
        <section class="rounded-xl border border-slate-200 p-3"><h2 class="text-sm font-semibold">{{ text.targetMean }}</h2><p class="text-xl">{{ value(report.data.summary.meanTargetKcal) }} kcal</p><p class="text-xs">{{ text.known }}: {{ report.data.summary.targetDays }}/{{ report.data.summary.days }} {{ text.days }}</p></section>
        <section class="rounded-xl border border-slate-200 p-3"><h2 class="text-sm font-semibold">{{ text.weight }}</h2><p class="text-xl">{{ value(report.data.summary.firstWeightKg) }} → {{ value(report.data.summary.lastWeightKg) }} kg</p><p class="text-xs">{{ report.data.summary.measurements }} {{ text.measurements }}</p></section>
        <section class="rounded-xl border border-slate-200 p-3"><h2 class="text-sm font-semibold">{{ text.gaps }}</h2><p class="text-sm">{{ text.intake }}: {{ report.data.summary.days - report.data.summary.intakeDays }} {{ text.days }}<br>{{ text.baseline }}: {{ report.data.summary.days - report.data.summary.targetDays }} {{ text.days }}</p></section>
      </div>
      <StatisticsChart :title="text.calories" unit="kcal" :days="report.data.days" :series="calorieSeries" :empty-label="text.noData" />
      <StatisticsChart :title="text.weight" unit="kg" :days="report.data.days" :series="weightSeries" :empty-label="text.noData" points-only />
      <p class="text-xs">{{ text.chartHint }}</p>
      <section class="statistics-table-section">
        <h2 class="mb-2 text-lg font-semibold">{{ text.daily }}</h2>
        <div class="overflow-x-auto">
          <table class="statistics-table w-full border-collapse text-right text-xs">
            <caption class="pb-2 text-left">{{ text.tableHint }}</caption>
            <thead><tr><th>{{ text.date }}</th><th>{{ text.weight }}<br>kg</th><th>{{ text.need }}<br>kcal</th><th>{{ text.baseline }}<br>kcal</th><th>{{ text.bonus }}<br>kcal</th><th>{{ text.budget }}<br>kcal</th><th>{{ text.intake }}<br>kcal</th><th>{{ text.meals }}</th></tr></thead>
            <tbody><tr v-for="day in report.data.days" :key="day.date"><th class="font-normal">{{ day.date }}</th><td>{{ value(day.weightKg) }}</td><td>{{ value(day.needKcal) }}</td><td>{{ value(day.targetKcal) }}</td><td>{{ value(day.bonusKcal) }}</td><td>{{ value(day.budgetKcal) }}</td><td>{{ value(day.intakeKcal) }}</td><td>{{ day.mealCount || '—' }}</td></tr></tbody>
          </table>
        </div>
      </section>
    </article>
  </main>
</template>
<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { buildProfileStatistics, statisticsDates } from '../../shared/domain/profile-statistics'
import { localCalendarDate } from '../../shared/domain/profile-calorie-command'
const { locale } = useI18n()
const native = Capacitor.isNativePlatform()
const text = computed(() => locale.value.startsWith('de') ? {
  title: 'Profilstatistik', profile: 'Profil', choose: 'Profil auswählen', from: 'Von', to: 'Bis', show: 'Anzeigen / aktualisieren', print: 'Drucken / als PDF speichern', rangeHint: 'Bis zu 366 Kalendertage pro Bericht. PDF über den Druckdialog des Webbrowsers speichern.', created: 'Datenstand', changed: 'Auswahl geändert – Bericht bitte erneut anzeigen.',
  disclaimer: 'Aufzeichnungen, keine medizinische Diagnose. Fehlende Mahlzeiten bedeuten nicht 0 kcal; auch erfasste Tage können unvollständig sein. Aufnahme wird aus gespeicherten Portionen und den aktuell hinterlegten Lebensmittel-/Gerichtnährwerten berechnet, nicht aus unveränderlichen historischen Nährwert-Snapshots. Bedarf ist eine Modellschätzung. Grundziele sind die damaligen gespeicherten Zielstände; Tagesbudget enthält zusätzlich gebuchte Bewegung.',
  intakeMean: 'Ø erfasste Aufnahme', targetMean: 'Ø bekanntes Grundziel', recorded: 'Erfasste Tage', known: 'Bekannte Tage', days: 'Tage', weight: 'Gemessenes Gewicht', measurements: 'Messtage im Zeitraum', gaps: 'Tage ohne Daten', intake: 'Aufnahme', baseline: 'Grundziel', need: 'Geschätzter Bedarf', bonus: 'Bewegungsbonus', budget: 'Tagesbudget', calories: 'Kalorienverlauf', noData: 'Keine Daten im gewählten Zeitraum.', daily: 'Tageswerte', date: 'Datum', meals: 'Mahlzeiten',
  chartHint: 'Gewichtspunkte sind ausschließlich datierte Messungen, ohne Auffüllen oder Interpolation. Kalorienlinien werden bei fehlenden Tagen unterbrochen; Zielstände sind Stufen. Durchschnitte verwenden jeweils nur erfasste/bekannte Tage und sind bei unterschiedlicher Abdeckung nicht direkt vergleichbar.', tableHint: '— = nicht aufgezeichnet / nicht bekannt / nicht anwendbar. Ein Bewegungsbonus von 0 bedeutet keine gebuchte Zusatzbewegung.', rangeError: 'Bitte Profil und gültigen Zeitraum von höchstens 366 Tagen bis heute wählen.', loadError: 'Daten konnten nicht vollständig geladen werden. Bitte erneut versuchen.'
} : {
  title: 'Profile statistics', profile: 'Profile', choose: 'Select profile', from: 'From', to: 'To', show: 'Show / refresh', print: 'Print / save as PDF', rangeHint: 'Up to 366 calendar days per report. Save PDF through the web browser print dialog.', created: 'Data as of', changed: 'Selection changed – please refresh the report.',
  disclaimer: 'Records, not a medical diagnosis. Missing meals do not mean 0 kcal; recorded days may also be incomplete. Intake is calculated from stored portions and current food/recipe nutrition, not immutable historical nutrient snapshots. Need is a model estimate. Baseline targets are the stored historical targets; daily budgets additionally include booked movement.',
  intakeMean: 'Mean recorded intake', targetMean: 'Mean known baseline', recorded: 'Recorded days', known: 'Known days', days: 'days', weight: 'Measured weight', measurements: 'measurement days in range', gaps: 'Days without data', intake: 'Intake', baseline: 'Baseline', need: 'Estimated need', bonus: 'Movement bonus', budget: 'Daily budget', calories: 'Calorie history', noData: 'No data in selected period.', daily: 'Daily values', date: 'Date', meals: 'Meals',
  chartHint: 'Weight points are dated observations only, without filling or interpolation. Calorie lines break at missing days; targets are steps. Averages use only recorded/known days respectively and are not directly comparable when coverage differs.', tableHint: '— = not recorded / unknown / not applicable. A 0 movement bonus means no additional movement was booked.', rangeError: 'Please choose a profile and valid period of at most 366 days ending no later than today.', loadError: 'Could not load complete data. Please try again.'
})
const { profiles, refreshProfiles } = useProfiles(), service = useMunchlingData(), route = useRoute()
const { currentProfileId } = useCurrentProfile()
const selectedId = ref<number | string>(''), today = ref(localCalendarDate()), to = ref(today.value)
const from = ref(new Date(Date.parse(today.value+'T00:00:00Z')-29*86400000).toISOString().slice(0,10))
const loading = ref(false), error = ref('')
type Report = { id: number; name: string; from: string; to: string; created: string; data: ReturnType<typeof buildProfileStatistics> }
const report = shallowRef<Report | null>(null)
const matchesFilters = computed(() => report.value?.id === Number(selectedId.value) && report.value?.from === from.value && report.value?.to === to.value)
const value = (number: number | null) => number === null ? '—' : number.toLocaleString(locale.value, { maximumFractionDigits: 2 })
const calorieSeries = computed(() => [
  { key: 'needKcal' as const, label: text.value.need, color: '#7c3aed', dashed: true, step: true },
  { key: 'targetKcal' as const, label: text.value.baseline, color: '#2563eb', dashed: true, step: true },
  { key: 'budgetKcal' as const, label: text.value.budget, color: '#15803d', step: true },
  { key: 'intakeKcal' as const, label: text.value.intake, color: '#c2410c' }
])
const weightSeries = computed(() => [{ key: 'weightKg' as const, label: text.value.weight, color: '#2563eb' }])
let request = 0
async function load() {
  const id = Number(selectedId.value), start = from.value, end = to.value, token = ++request
  error.value = ''; report.value = null; loading.value = false; today.value = localCalendarDate()
  try { statisticsDates(start,end); if (!Number.isSafeInteger(id) || id < 1 || end > today.value) throw new Error() }
  catch { error.value = text.value.rangeError; return }
  loading.value = true
  try {
    await refreshProfiles()
    const profile = profiles.value.find(row => row.id === id)
    if (!profile) throw new Error()
    const [meals, activities] = await Promise.all([service.mealLogs.listMealLogs({ profileId: id }), service.activityLogs.listActivityLogs()])
    const data = buildProfileStatistics(profile,meals,activities,start,end)
    if (token === request) report.value = { id, name: profile.name, from: start, to: end, created: new Date().toLocaleString(locale.value), data }
  } catch { if (token === request) error.value = text.value.loadError }
  finally { if (token === request) loading.value = false }
}
function printReport() { if (report.value && matchesFilters.value && !loading.value) window.print() }
onMounted(async () => {
  try {
    await refreshProfiles()
    const query = typeof route.query.profile === 'string' ? Number(route.query.profile) : null
    const current = currentProfileId.value
    selectedId.value = query ?? current ?? profiles.value[0]?.id ?? ''
    if (selectedId.value) await load()
  } catch { error.value = text.value.loadError }
})
onBeforeUnmount(() => { request++ })
</script>
<style>
.statistics-table th, .statistics-table td { padding: .5rem; border-bottom: 1px solid #cbd5e1; white-space: nowrap; }
.statistics-table th:first-child { text-align: left; }
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: white !important; color: black !important; }
  .app-navigation, .skip-link, .app-alert, .statistics-controls { display: none !important; }
  .app-workspace { margin: 0 !important; padding: 0 !important; }
  .statistics-page { width: 100%; max-width: none; gap: 0; }
  .statistics-report, .statistics-report * { color: black; background: white; box-shadow: none; }
  .statistics-report { font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .statistics-report h1 { font-size: 18pt; }
  .statistics-report h2 { font-size: 12pt; }
  .statistics-summary { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
  .statistics-chart, .statistics-summary, .statistics-report > header { break-inside: avoid; }
  .statistics-chart svg { max-height: 65mm; }
  .statistics-table-section .overflow-x-auto { overflow: visible; }
  .statistics-table { font-size: 8pt; }
  .statistics-table th, .statistics-table td { padding: 2mm 1mm; white-space: normal; }
  .statistics-table thead { display: table-header-group; }
  .statistics-table tr { break-inside: avoid; }
  .statistics-report p { orphans: 3; widows: 3; }
}
</style>
