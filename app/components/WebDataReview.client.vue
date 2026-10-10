<template>
  <section v-if="conflict || deletion || error || completed" class="app-alert min-w-0 space-y-4 rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950" aria-live="polite">
    <template v-if="conflict">
      <h2 class="font-semibold">{{ $t('web.review.conflict') }}</h2>
      <p>{{ $t('web.review.noOverwrite') }}</p>
      <p v-if="!conflict.serverAvailable">{{ $t('web.review.serverUnavailable') }}</p>
      <article v-for="row in conflict.rows" :key="row.id" class="min-w-0 space-y-2 border-t border-amber-300 pt-3">
        <p class="break-all text-sm">{{ row.entity }} · {{ row.id }} · v{{ row.revision }}</p>
        <div class="grid min-w-0 gap-3 lg:grid-cols-3">
          <div class="min-w-0"><h3 class="font-semibold">{{ $t('web.review.base') }}</h3><SyncVersionView v-if="row.base" :payload="row.base" /><p v-else>{{ $t('web.review.baseUnknown') }}</p></div>
          <div class="min-w-0"><h3 class="font-semibold">{{ $t('web.review.draft') }}</h3><p v-if="row.raw" class="text-xs">{{ $t('web.review.rawDraft') }}</p><SyncVersionView :payload="row.draft" /><pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(row.draft, null, 2) }}</pre></div>
          <div class="min-w-0"><h3 class="font-semibold">{{ $t('web.review.server') }}</h3><SyncVersionView v-if="conflict.serverAvailable" :payload="row.server" /><p v-else>{{ $t('web.review.serverUnavailable') }}</p></div>
        </div>
      </article>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary" :disabled="busy" @click="exportDraft">{{ $t('web.review.export') }}</button>
        <button class="btn-secondary" :disabled="busy" @click="dismissConflict">{{ $t('web.review.keepDraft') }}</button>
      </div>
      <label class="flex min-h-11 items-center gap-2"><input v-model="reloadConfirmed" type="checkbox" :disabled="busy || pending">{{ $t('web.review.reloadWarning') }}</label>
      <button class="btn-secondary" :disabled="busy || pending || !reloadConfirmed" @click="reload">{{ $t('web.review.reload') }}</button>
    </template>
    <template v-if="deletion">
      <h2 class="font-semibold">{{ $t('web.review.deleteTitle') }}</h2>
      <p>{{ $t('web.review.deleteRule') }}</p>
      <p class="break-all text-sm">{{ deletion.root.entity }} · {{ deletion.root.id }} · v{{ deletion.root.version }}</p>
      <SyncVersionView :payload="deletion.root" />
      <details v-for="group in deletionGroups" :key="group.title" :open="group.rows.length > 0">
        <summary>{{ $t(group.title) }} ({{ group.rows.length }})</summary>
        <ul class="max-h-64 space-y-3 overflow-auto"><li v-for="row in group.rows" :key="row.id"><p class="break-all text-xs">{{ row.entity }} · {{ row.id }} · v{{ row.version }}</p><SyncVersionView :payload="row" /></li></ul>
      </details>
      <p v-if="deletion.history.length" role="alert" class="font-semibold">{{ $t('web.review.historyBlocked') }}</p>
      <label v-else class="flex min-h-11 items-center gap-2"><input v-model="deleteConfirmed" type="checkbox" :disabled="busy || pending">{{ $t('web.review.confirmDelete') }}</label>
      <div class="flex flex-wrap gap-2">
        <button class="min-h-11 rounded-lg border border-red-700 bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50" :disabled="busy || pending || !deleteConfirmed || !!deletion.history.length" @click="commitDeletion">{{ $t('web.review.delete') }}</button>
        <button class="btn-secondary" :disabled="busy" @click="cancelDeletion">{{ $t('common.cancel') }}</button>
      </div>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="completed" role="status">{{ $t('web.review.deleted') }}</p>
  </section>
</template>
<script setup lang="ts">
import type { createHttpDataService } from '~/utils/data/http'
const service = useMunchlingData() as Partial<ReturnType<typeof createHttpDataService>>
const { t } = useI18n()
const conflict = shallowRef<ReturnType<NonNullable<typeof service.getWriteConflict>>>()
const deletion = shallowRef<ReturnType<NonNullable<typeof service.getDeletionReview>>>()
const busy = ref(false),pending = ref(false),deleteConfirmed = ref(false),reloadConfirmed = ref(false),completed = ref(false),error = ref('')
let timer: ReturnType<typeof setInterval> | undefined
const deletionGroups = computed(() => deletion.value ? [
  { title: 'web.review.direct',rows: deletion.value.dependents },
  { title: 'web.review.indirect',rows: deletion.value.indirect },
  { title: 'web.review.history',rows: deletion.value.history },
] : [])
function check() {
  const next = service.getDeletionReview?.()
  if (next?.token !== deletion.value?.token) { deleteConfirmed.value = false; if (next) { error.value = ''; completed.value = false } }
  const nextConflict = service.getWriteConflict?.()
  if (nextConflict !== conflict.value) reloadConfirmed.value = false
  deletion.value = next; conflict.value = nextConflict
  try { pending.value = service.hasPendingWrite?.() ?? false } catch { pending.value = true }
}
function dismissConflict() { service.clearWriteConflict?.(); check() }
function cancelDeletion() { service.cancelDeletion?.(); check() }
function reload() { if (reloadConfirmed.value && !pending.value && !busy.value) window.location.reload() }
function exportDraft() {
  if (!conflict.value) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(conflict.value,null,2)],{ type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `munchling-web-draft-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000)
}
const { refreshFoods } = useFoods(), { refreshRecipes } = useRecipes(), { refreshProfiles } = useProfiles(), { refreshMealLogs } = useMealLogs(), { refreshActivities } = useActivities()
async function commitDeletion() {
  if (!deletion.value || deletion.value.history.length || !deleteConfirmed.value || pending.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await service.confirmDeletion?.(deletion.value.token,true)
    await Promise.all([refreshFoods(),refreshRecipes(),refreshProfiles(),refreshMealLogs(),refreshActivities()])
    completed.value = true
  } catch { error.value = t('web.review.failed') }
  finally { busy.value = false; check() }
}
onMounted(() => { check(); if (service.getDeletionReview || service.getWriteConflict) timer = setInterval(check,500) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
