<template>
  <div class="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" :aria-busy="busy">
    <h3 class="font-semibold">{{ $t('settings.syncDecision.title') }}</h3>
    <p class="text-sm">{{ $t('settings.syncDecision.scope') }}</p>
    <button v-if="!state?.cursor" type="button" :disabled="blocked || !ready" class="min-h-11 rounded-xl bg-slate-200 px-3 disabled:opacity-50 dark:bg-slate-800" @click="previewInitial">{{ $t('settings.syncDecision.initialReview') }}</button>
    <button v-else type="button" :disabled="blocked" class="min-h-11 rounded-xl bg-slate-200 px-3 disabled:opacity-50 dark:bg-slate-800" @click="previewConflicts">{{ $t('settings.syncDecision.conflictReview') }}</button>
    <div v-if="initial" class="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
      <p class="text-sm">{{ $t('settings.syncDecision.inventory', { local: initial.localCount, server: initial.serverCount }) }}</p>
      <label v-for="option in modes" :key="option" class="flex min-h-11 gap-2 text-sm"><input v-model="mode" type="radio" :value="option" :disabled="busy || option === 'local' && initial.serverCount > 0"><span>{{ $t(`settings.syncDecision.modes.${option}`) }}</span></label>
      <p v-if="mode === 'server'" class="text-sm font-semibold text-red-700 dark:text-red-300">{{ $t('settings.syncDecision.replaceWarning') }}</p>
      <p class="text-sm">{{ $t('settings.syncDecision.backupHint') }}</p>
      <label class="flex min-h-11 items-center gap-2 text-sm"><input v-model="confirmed" type="checkbox" :disabled="busy">{{ $t('settings.syncDecision.confirm') }}</label>
      <button type="button" :disabled="blocked || !confirmed" class="min-h-11 rounded-xl bg-munchling-600 px-3 font-semibold text-white disabled:opacity-50" @click="commitInitial">{{ $t('settings.syncDecision.apply') }}</button>
      <button type="button" :disabled="busy" class="min-h-11 px-3" @click="cancel">{{ $t('common.cancel') }}</button>
    </div>
    <div v-if="conflict" class="space-y-3">
      <p class="text-sm">{{ $t('settings.syncDecision.groups', { groups: conflict.groups, roots: conflict.entries.length }) }}</p>
      <p v-if="!conflict.entries.length" class="text-sm">{{ $t('settings.syncDecision.noConflicts') }}</p>
      <article v-for="entry in conflict.entries" :key="entry.id" class="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
        <h4 class="text-sm font-semibold">{{ $t(`settings.syncPreparation.entities.${entry.entity}`) }}</h4>
        <p class="break-all text-xs text-slate-500">{{ entry.id }}</p>
        <div class="grid grid-cols-1 gap-3">
          <div><p class="text-xs font-semibold">{{ $t('settings.syncDecision.base') }}</p><SyncVersionView :payload="entry.base" /></div>
          <div><p class="text-xs font-semibold">{{ $t('settings.syncDecision.local') }}</p><SyncVersionView :payload="entry.local" /></div>
          <div><p class="text-xs font-semibold">{{ $t('settings.syncDecision.serverVersion', { version: entry.remote?.version ?? 0 }) }}</p><SyncVersionView :payload="entry.remote" /></div>
        </div>
        <label class="flex min-h-11 gap-2 text-sm"><input v-model="choices[entry.id]" type="radio" :name="entry.id" value="local" :disabled="busy || !entry.local">{{ $t('settings.syncDecision.keepLocal') }}</label>
        <label class="flex min-h-11 gap-2 text-sm"><input v-model="choices[entry.id]" type="radio" :name="entry.id" value="server" :disabled="busy || !entry.remote">{{ $t('settings.syncDecision.keepServer') }}</label>
      </article>
      <template v-if="conflict.entries.length">
        <p class="text-sm">{{ $t('settings.syncDecision.dependencies') }}</p>
        <p class="text-sm">{{ $t('settings.syncDecision.backupHint') }}</p>
        <label class="flex min-h-11 gap-2 text-sm"><input v-model="confirmed" type="checkbox" :disabled="busy">{{ $t('settings.syncDecision.confirm') }}</label>
        <label v-if="hasDeletion" class="flex min-h-11 gap-2 text-sm"><input v-model="confirmDeletion" type="checkbox" :disabled="busy">{{ $t('settings.syncDecision.confirmDeletion') }}</label>
        <button type="button" :disabled="blocked || !confirmed || !allChosen || hasDeletion && !confirmDeletion" class="min-h-11 rounded-xl bg-munchling-600 px-3 font-semibold text-white disabled:opacity-50" @click="resolve">{{ $t('settings.syncDecision.apply') }}</button>
      </template>
      <button type="button" :disabled="busy" class="min-h-11 px-3" @click="cancel">{{ $t('common.cancel') }}</button>
    </div>
    <button v-if="recovery" type="button" :disabled="busy || disabled" class="min-h-11 rounded-xl px-3 text-sm disabled:opacity-50" @click="exportRecovery">{{ $t('settings.syncDecision.exportRecovery') }}</button>
    <p v-if="busy" role="status" class="text-sm">{{ $t('common.loading') }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-if="success" role="status" class="text-sm">{{ success }}</p>
  </div>
</template>
<script setup lang="ts">
import { databaseSql } from '~/utils/database/sql'
import { createSyncDecisions, type InitialReview, type ConflictReview, type InitialMode, type DecisionChoice } from '~/utils/sync/decisions'
import { createSnapshotStaging, type ReceiveState } from '~/utils/sync/staging'
import { fetchDecisionProof } from '~/utils/sync/proof'
import { saveSyncDecisionBackup, hasSyncDecisionBackup, readSyncDecisionBackup, exportBackupFile } from '~/utils/backup/files'
import { SyncClientError } from '../../shared/domain/replies'
const props = defineProps<{ revision: number; approved: boolean; disabled: boolean }>(), emit = defineEmits<{ changed: []; busy: [value: boolean] }>()
const { t, te } = useI18n(), stage = createSnapshotStaging(databaseSql), decisions = createSyncDecisions(databaseSql, saveSyncDecisionBackup)
const busy = ref(false), error = ref(''), success = ref(''), recovery = ref(false), ready = ref(false), state = shallowRef<ReceiveState | null>(null)
const initial = shallowRef<InitialReview | null>(null), conflict = shallowRef<ConflictReview | null>(null), choices = ref<Record<string, DecisionChoice>>({})
const modes: InitialMode[] = ['combine', 'local', 'server'], mode = ref<InitialMode>('combine'), confirmed = ref(false), confirmDeletion = ref(false)
const blocked = computed(() => busy.value || props.disabled || !props.approved)
const hasDeletion = computed(() => conflict.value?.entries.some(entry => entry.deletedLocally || !!entry.remote?.deletedAt))
const allChosen = computed(() => conflict.value?.entries.every(entry => choices.value[entry.id] === 'local' || choices.value[entry.id] === 'server'))
const { refreshProfiles } = useProfiles(), { refreshFoods } = useFoods(), { refreshRecipes, selectedRecipe } = useRecipes(), { refreshMealLogs } = useMealLogs(), { selectProfile, initializeCurrentProfile } = useCurrentProfile()
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
function cancel() { initial.value = null; conflict.value = null; choices.value = {}; confirmed.value = false; confirmDeletion.value = false }
async function refresh() { state.value = await stage.state(); ready.value = (await stage.progress())?.ready ?? false; recovery.value = await hasSyncDecisionBackup() }
async function run(work: () => Promise<void>, network = true) {
  if (busy.value || props.disabled || network && !props.approved) return
  busy.value = true; emit('busy', true); error.value = ''; success.value = ''
  try { await work() } catch (cause) {
    const code = cause instanceof SyncClientError ? cause.code : 'localOrNetworkError'
    error.value = te(`settings.syncDecision.errors.${code}`) ? t(`settings.syncDecision.errors.${code}`) : t('settings.syncPreparation.failed', { code })
    if (['previewChanged', 'localReset', 'serverChanged'].includes(code)) cancel()
  } finally { busy.value = false; emit('busy', false) }
}
async function previewInitial() { await run(async () => { cancel(); initial.value = await decisions.initialPreview(); mode.value = 'combine' }) }
async function previewConflicts() {
  await run(async () => {
    cancel(); const current = await stage.state(); if (!current.url) throw new SyncClientError('notInitialized')
    conflict.value = await decisions.conflictPreview(await fetchDecisionProof(current.url, current, controller.signal))
  })
}
async function dataChanged() {
  cancel(); await refresh(); emit('changed')
  selectedRecipe.value = null; selectProfile(null)
  await Promise.all([refreshProfiles(), refreshFoods(), refreshRecipes(), refreshMealLogs()]); await initializeCurrentProfile()
}
async function commitInitial() {
  if (!confirmed.value || !initial.value) return
  const review = initial.value, selected = mode.value
  await run(async () => {
    const stored = await stage.complete(), fresh = await fetchDecisionProof(review.url, stored.manifest, controller.signal)
    const result = await decisions.initialCommit(review.token, selected, fresh)
    await dataChanged(); success.value = t(result.status === 'blocked' ? 'settings.syncDecision.connectedBlocked' : 'settings.syncDecision.connected')
  })
}
async function resolve() {
  if (!confirmed.value || !allChosen.value || !conflict.value || hasDeletion.value && !confirmDeletion.value) return
  const review = conflict.value, selected = { ...choices.value }, deletion = confirmDeletion.value
  await run(async () => {
    const current = await stage.state(), fresh = await fetchDecisionProof(review.url, current, controller.signal)
    await decisions.resolve(review.token, selected, fresh, deletion)
    await dataChanged(); success.value = t('settings.syncDecision.resolved')
  })
}
async function exportRecovery() { await run(async () => exportBackupFile(await readSyncDecisionBackup(), 'munchling-before-sync-decision'), false) }
watch(mode, () => { confirmed.value = false })
watch(choices, () => { confirmed.value = false; confirmDeletion.value = false }, { deep: true })
watch(() => [props.revision, props.disabled], () => { if (!props.disabled) { cancel(); void run(refresh, false) } })
onMounted(() => { void run(refresh, false) })
</script>
