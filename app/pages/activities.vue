<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header><h1 class="text-3xl font-bold">{{ $t('activities.title') }}</h1><p class="mt-2 text-sm text-slate-500">{{ $t('activities.description') }}</p></header>
    <section class="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 class="mb-4 font-semibold">{{ editing ? $t('common.edit') : $t('activities.create') }}</h2>
      <form class="space-y-4" @submit.prevent="save">
        <label class="block"><span>{{ $t('activities.name') }}</span><input v-model="form.name" required class="field"></label>
        <label class="block"><span>{{ $t('activities.duration') }}</span><input v-model.number="form.durationMinutes" type="number" min="0.01" step="0.01" required inputmode="decimal" class="field"></label>
        <label class="block"><span>{{ $t('activities.calories') }}</span><input v-model.number="form.calories" type="number" min="0" step="0.01" required inputmode="decimal" class="field"></label>
        <button type="submit" :disabled="busy" class="min-h-12 w-full rounded-2xl bg-munchling-600 px-4 font-semibold text-white disabled:opacity-50">{{ editing ? $t('common.save') : $t('activities.create') }}</button>
        <button v-if="editing" type="button" class="min-h-11 px-4" @click="reset">{{ $t('common.cancel') }}</button>
      </form>
      <p v-if="error" role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold">{{ $t('activities.templates') }}</h2>
      <article v-for="activity in activities" :key="activity.id" class="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 class="font-semibold">{{ activity.name }}</h3><p class="mt-1 text-sm text-slate-500">{{ $t('activities.perUnit', { minutes: activity.durationMinutes, calories: activity.calories }) }}</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" class="col-span-2 min-h-11 rounded-2xl bg-munchling-600 px-3 text-sm font-semibold text-white" @click="choose(activity)">{{ $t('activities.add') }}</button>
          <button type="button" class="min-h-11 rounded-2xl bg-slate-100 px-3 text-sm dark:bg-slate-800" :disabled="busy" @click="edit(activity)">{{ $t('common.edit') }}</button>
          <button type="button" class="min-h-11 rounded-2xl bg-red-50 px-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" :disabled="busy" @click="removeTemplate(activity)">{{ $t('common.delete') }}</button>
        </div>
      </article>
      <p v-if="!activities.length" class="text-sm text-slate-500">{{ $t('activities.empty') }}</p>
    </section>
    <div id="activity-entry"><ActivityEntry ref="entry" /></div>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold">{{ $t('activities.logs') }}</h2>
      <article v-for="log in activityLogs" :key="log.id" class="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 class="font-semibold">{{ log.name }} · {{ profiles.find(p => p.id === log.profileId)?.name }}</h3>
        <p class="text-sm text-slate-500">{{ log.date }} · {{ log.units }} {{ $t('activities.units') }}</p>
        <p class="mt-1 text-sm">{{ $t('activities.preview', activityTotals(log, log.units)) }}</p>
        <button type="button" class="mt-2 min-h-11 rounded-2xl bg-red-50 px-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" :disabled="busy" @click="removeLog(log)">{{ $t('common.delete') }}</button>
      </article>
    </section>
    <AppBottomNav />
  </main>
</template>
<script setup lang="ts">
import { activityTotals, type Activity, type ActivityLog } from '../../shared/domain/activities'
import { validationMessage } from '../../shared/domain/validation'
const { t } = useI18n()
const { activities, activityLogs, refreshActivities, createActivity, updateActivity, deleteActivity, deleteActivityLog } = useActivities()
const { profiles } = useProfiles()
const entry = ref<{ choose: (activity: Activity) => void } | null>(null)
const editing = shallowRef<Activity | null>(null), busy = ref(false), error = ref('')
const form = reactive({ name: '', durationMinutes: 30, calories: 0 })
function reset() { editing.value = null; Object.assign(form, { name: '', durationMinutes: 30, calories: 0 }); error.value = '' }
function edit(activity: Activity) { editing.value = activity; Object.assign(form, { name: activity.name, durationMinutes: activity.durationMinutes, calories: activity.calories }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
function choose(activity: Activity) { entry.value?.choose(activity); document.querySelector('#activity-entry')?.scrollIntoView({ behavior: 'smooth' }) }
async function action(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await work(); await refreshActivities() } catch (cause) { error.value = validationMessage(cause,t) } finally { busy.value = false }
}
async function save() { await action(async () => { if (editing.value) await updateActivity(editing.value.id, { ...form }, editing.value.revision); else await createActivity({ ...form }); reset() }) }
async function removeTemplate(activity: Activity) { if (confirm(t('activities.confirmTemplateDelete', { name: activity.name }))) await action(async () => { await deleteActivity(activity.id,activity.revision); if (editing.value?.id === activity.id) reset() }) }
async function removeLog(log: ActivityLog) { if (confirm(t('activities.confirmLogDelete', { name: log.name }))) await action(() => deleteActivityLog(log.id,log.revision)) }
</script>
<style scoped>
.field { @apply min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-munchling-600 dark:border-slate-700 dark:bg-slate-950; }
</style>
