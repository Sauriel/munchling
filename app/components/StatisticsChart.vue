<template>
  <section class="statistics-chart rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
    <h2 class="text-lg font-semibold">{{ title }}</h2>
    <ul class="my-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <li v-for="line in series" :key="line.key"><span :style="{ color: line.color }">{{ line.dashed ? '┄' : '●' }}</span> {{ line.label }} ({{ unit }})</li>
    </ul>
    <svg v-if="values.length" viewBox="0 0 640 210" role="img" :aria-label="title" class="w-full">
      <g v-for="tick in ticks" :key="tick.value">
        <line x1="52" x2="625" :y1="tick.y" :y2="tick.y" stroke="#cbd5e1" stroke-width="0.5" />
        <text x="45" :y="tick.y + 4" text-anchor="end" font-size="11" fill="currentColor">{{ format(tick.value) }}</text>
      </g>
      <g v-for="line in plotted" :key="line.key">
        <path v-if="!pointsOnly" :d="line.path" fill="none" :stroke="line.color" :stroke-dasharray="line.dashed ? '5 4' : undefined" stroke-width="2" />
        <circle v-for="point in line.points" :key="point.date" :cx="point.x" :cy="point.y" r="2.7" :fill="line.color"><title>{{ point.date }}: {{ format(point.value) }} {{ unit }} · {{ line.label }}</title></circle>
      </g>
      <text x="52" y="202" font-size="11" fill="currentColor">{{ days[0]?.date }}</text>
      <text x="625" y="202" font-size="11" fill="currentColor" text-anchor="end">{{ days.at(-1)?.date }}</text>
    </svg>
    <p v-else class="py-8 text-sm">{{ emptyLabel }}</p>
  </section>
</template>
<script setup lang="ts">
import type { StatisticsDay } from '../../shared/domain/profile-statistics'
type Key = 'weightKg' | 'needKcal' | 'targetKcal' | 'budgetKcal' | 'intakeKcal'
const props = defineProps<{ title: string; unit: string; days: StatisticsDay[]; series: { key: Key; label: string; color: string; dashed?: boolean; step?: boolean }[]; emptyLabel: string; pointsOnly?: boolean }>()
const { locale } = useI18n()
const format = (value: number) => value.toLocaleString(locale.value, { maximumFractionDigits: 1 })
const values = computed(() => props.days.flatMap(day => props.series.flatMap(line => day[line.key] === null ? [] : [day[line.key]!])) )
const min = computed(() => props.pointsOnly ? Math.floor(Math.min(...values.value) - 1) : 0)
const max = computed(() => Math.max(min.value + 1, Math.ceil(Math.max(...values.value) * (props.pointsOnly ? 1 : 1.05))))
const y = (value: number) => 175 - (value-min.value)/(max.value-min.value)*150
const ticks = computed(() => [0,0.5,1].map(fraction => { const value = min.value + fraction*(max.value-min.value); return { value, y: y(value) } }))
const plotted = computed(() => props.series.map(line => {
  let path = '', previous = false
  const points: { date: string; value: number; x: number; y: number }[] = []
  props.days.forEach((day,index) => {
    const value = day[line.key]
    if (value === null) { previous = false; return }
    const x = props.days.length === 1 ? 338 : 52 + index/(props.days.length-1)*573, vertical = y(value)
    path += previous ? line.step ? ` H${x} V${vertical}` : ` L${x},${vertical}` : ` M${x},${vertical}`
    points.push({ date: day.date, value, x, y: vertical }); previous = true
  })
  return { ...line, points, path }
}))
</script>
