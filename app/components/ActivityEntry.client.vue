<template>
  <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <h2 class="mb-4 font-semibold">{{ $t('activities.add') }}</h2>
    <form class="space-y-4" @submit.prevent="submit">
      <label class="block space-y-1.5">
        <span>{{ $t('activities.template') }}</span>
        <select v-model.number="selectedId" required class="field" @change="choose(activities.find(a => a.id === selectedId) ?? null)">
          <option :value="null" disabled>{{ $t('activities.select') }}</option>
          <option v-for="activity in activities" :key="activity.id" :value="activity.id">{{ activity.name }}</option>
        </select>
      </label>
      <p v-if="selection" class="text-sm text-slate-500">{{ $t('activities.perUnit', { minutes: selection.durationMinutes, calories: selection.calories }) }}</p>
      <label class="block space-y-1.5"><span>{{ $t('activities.date') }}</span><input v-model="date" type="date" required class="field"></label>
      <label v-for="profile in visibleProfiles" :key="profile.id" class="block rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
        <span class="block font-medium">{{ profile.name }} · {{ $t('activities.units') }}</span>
        <input v-model.number="units[profile.id]" type="number" min="0" step="any" inputmode="decimal" class="field" :aria-label="`${profile.name}: ${$t('activities.units')}`">
        <span v-if="selection && Number(units[profile.id]) > 0" class="text-xs text-slate-500">{{ preview(profile.id) }}</span>
      </label>
      <p v-if="!visibleProfiles.length" class="text-sm text-slate-500">{{ $t('activities.noProfiles') }}</p>
      <button type="submit" :disabled="busy || !selection || !hasUnits" class="min-h-12 w-full rounded-2xl bg-munchling-600 px-4 font-semibold text-white disabled:opacity-50">{{ $t('activities.add') }}</button>
      <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <p v-if="success" role="status" class="text-sm text-munchling-700 dark:text-munchling-500">{{ $t('activities.added') }}</p>
    </form>
  </section>
</template>
<script setup lang="ts">
import type { Activity } from '../../shared/domain/activities'
import { activityTotals } from '../../shared/domain/activities'
import { validationMessage } from '../../shared/domain/validation'
const props = defineProps<{ profileId?: number }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const { activities, refreshActivities, createActivityLogs } = useActivities()
const { profiles, refreshProfiles } = useProfiles()
const selection = shallowRef<Activity | null>(null), selectedId = ref<number | null>(null)
const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
const date = ref(now.toISOString().slice(0,10)), units = reactive<Record<number, number>>({})
const busy = ref(false), error = ref(''), success = ref(false)
const visibleProfiles = computed(() => props.profileId === undefined ? profiles.value : profiles.value.filter(p => p.id === props.profileId))
const hasUnits = computed(() => visibleProfiles.value.some(p => Number(units[p.id]) > 0))
function choose(activity: Activity | null) { selection.value = activity; selectedId.value = activity?.id ?? null; error.value = ''; success.value = false }
function preview(id: number) {
  try { const total = activityTotals(selection.value!, Number(units[id])); return t('activities.preview', { durationMinutes: total.durationMinutes, calories: total.calories }) } catch { return '' }
}
async function submit() {
  if (busy.value || !selection.value) return
  busy.value = true; error.value = ''; success.value = false
  try {
    await createActivityLogs({ activityId: selection.value.id, activityRevision: selection.value.revision, date: date.value, profiles: visibleProfiles.value.map(p => ({ profileId: p.id, units: Number(units[p.id]) || 0 })).filter(p => p.units > 0) })
    await refreshActivities(); for (const p of visibleProfiles.value) units[p.id] = 0
    success.value = true; emit('saved')
  } catch (cause) { error.value = validationMessage(cause, t) } finally { busy.value = false }
}
onMounted(async () => { try { await Promise.all([refreshActivities(), refreshProfiles()]) } catch (cause) { error.value = validationMessage(cause,t) } })
defineExpose({ choose })
</script>
<style scoped>
.field { @apply min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-munchling-600 dark:border-slate-700 dark:bg-slate-950; }
</style>
