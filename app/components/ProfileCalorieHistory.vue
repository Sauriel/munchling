<template>
  <section class="mt-4 space-y-3">
    <h3 class="font-semibold">{{ de ? 'Datiertes Gewicht & Grundziel' : 'Dated weight & baseline target' }}</h3>
    <p class="text-xs text-slate-500">{{ de ? 'Gespeicherte Fakten, keine rückwirkende Neuberechnung. Vor dem ersten Eintrag ist das damalige Ziel unbekannt. Diagramme: letzte 30 bekannte Tage / Messpunkte; Abstände entsprechen Kalendertagen.' : 'Stored facts, never retrospectively recalculated. Targets before the first entry are unknown. Charts: last 30 known days / observations; spacing follows calendar days.' }}</p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div v-for="chart in charts" :key="chart.name" class="min-w-0 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
        <h4 class="text-sm font-semibold">{{ chart.name }}</h4>
        <svg v-if="chart.points.length" viewBox="0 0 320 130" role="img" :aria-label="chart.name" class="w-full">
          <polyline :points="chart.line" fill="none" stroke="currentColor" stroke-width="2" class="text-munchling-600" />
          <circle v-for="point in chart.points" :key="point.id" :cx="point.x" :cy="point.y" r="3" class="fill-munchling-600"><title>{{ point.date }}: {{ point.value }} {{ chart.unit }}</title></circle>
          <text x="8" y="12" font-size="10" fill="currentColor">{{ chart.max }} {{ chart.unit }}</text><text x="8" y="112" font-size="10" fill="currentColor">{{ chart.min }} {{ chart.unit }}</text>
          <text x="8" y="127" font-size="9" fill="currentColor">{{ chart.points[0]?.date }}</text><text x="312" y="127" font-size="9" fill="currentColor" text-anchor="end">{{ chart.points.at(-1)?.date }}</text>
        </svg>
        <p v-else class="text-sm">{{ de ? 'Noch keine Daten' : 'No data yet' }}</p>
      </div>
    </div>
    <details><summary class="min-h-11 cursor-pointer text-sm">{{ de ? 'Letzte 30 unveränderlichen Einträge' : 'Last 30 immutable events' }} ({{ history.length }})</summary>
      <ul class="space-y-2 text-xs">
        <li v-for="entry in recent" :key="entry.id" class="rounded-lg bg-slate-50 p-2 dark:bg-slate-950">
          <p>#{{ entry.sequence }} · {{ entry.validFrom }} · {{ entry.state.mode === 'automatic' ? (de ? 'Automatisch' : 'Automatic') : (de ? 'Manuell' : 'Manual') }} · {{ entry.state.mode === 'automatic' ? entry.state.calculation?.targetKcal : entry.state.manualTargetKcal }} kcal</p>
          <p v-if="entry.measurement">{{ entry.measurement.measuredOn }}: {{ entry.measurement.weightKg }} kg</p>
          <p v-if="entry.state.calculation">{{ entry.state.calculation.modelVersion }} · {{ de ? 'Bedarf' : 'Need' }} {{ entry.state.calculation.estimatedNeedKcal }} kcal · {{ de ? 'Defizit' : 'Deficit' }} {{ entry.state.calculation.input.deficit.value }} {{ entry.state.calculation.input.deficit.mode === 'percent' ? '%' : 'kcal' }}</p>
          <p>{{ entry.createdAt }}</p>
        </li>
      </ul>
    </details>
  </section>
</template>
<script setup lang="ts">
import type { Profile } from '../../shared/domain/types'
const props = defineProps<{ profile: Profile }>()
const { locale } = useI18n()
const de = computed(() => locale.value.startsWith('de'))
const history = computed(() => props.profile.calorieHistory ?? [])
const recent = computed(() => [...history.value].sort((a,b) => b.sequence - a.sequence).slice(0,30))
type Datum = { id: string; date: string; value: number }
function chart(name: string,unit: string,values: Datum[]) {
  const rows = values.sort((a,b) => a.date.localeCompare(b.date)).slice(-30), min = Math.min(...rows.map(row => row.value)),max = Math.max(...rows.map(row => row.value))
  const start = Date.parse(rows[0]?.date ?? '2000-01-01'),end = Date.parse(rows.at(-1)?.date ?? '2000-01-01')
  const points = rows.map(row => ({ ...row,x: start === end ? 160 : 40 + (Date.parse(row.date) - start)/(end-start)*265,y: min === max ? 60 : 100 - (row.value-min)/(max-min)*80 }))
  return { name,unit,min,max,points,line: points.map(row => `${row.x},${row.y}`).join(' ') }
}
const charts = computed(() => {
  const targets = new Map<string,Datum>(),weights = new Map<string,Datum>()
  for (const row of [...history.value].sort((a,b) => a.sequence-b.sequence)) {
    targets.set(row.validFrom,{ id: row.id,date: row.validFrom,value: row.state.mode === 'automatic' ? row.state.calculation!.targetKcal : row.state.manualTargetKcal })
    if (row.measurement) weights.set(row.measurement.measuredOn,{ id: row.id,date: row.measurement.measuredOn,value: row.measurement.weightKg })
  }
  return [chart(de.value ? 'Grundziel (ohne Bewegungsbonus)' : 'Baseline (no movement bonus)','kcal',[...targets.values()]),chart(de.value ? 'Gemessenes Gewicht' : 'Measured weight','kg',[...weights.values()])]
})
</script>
