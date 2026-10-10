<template>
  <section v-if="native" class="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <h2 class="font-semibold">{{ $t('settings.syncAutomatic.title') }}</h2>
    <p class="text-sm">{{ $t('settings.syncAutomatic.scope') }}</p>
    <p v-if="!options.eligible" class="text-sm text-amber-800 dark:text-amber-200">{{ $t('settings.syncAutomatic.setup') }}</p>
    <label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" :checked="options.onStart" :disabled="loading || saving || !options.eligible" @change="change('onStart', ($event.target as HTMLInputElement).checked)" class="size-5">{{ $t('settings.syncAutomatic.start') }}</label>
    <label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" :checked="options.onResume" :disabled="loading || saving || !options.eligible" @change="change('onResume', ($event.target as HTMLInputElement).checked)" class="size-5">{{ $t('settings.syncAutomatic.resume') }}</label>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ $t('settings.syncAutomatic.failed', { code: error }) }}</p>
  </section>
</template>
<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { databaseSql } from '~/utils/database/sql'
import { createAutomaticSyncSettings } from '~/utils/sync/automatic-settings'
import { SyncClientError } from '../../shared/domain/replies'
const native = Capacitor.isNativePlatform(), settings = createAutomaticSyncSettings(databaseSql)
const options = ref({ eligible: false,onStart: false,onResume: false }), loading = ref(true), saving = ref(false), error = ref('')
let closed = false
onBeforeUnmount(() => { closed = true })
async function refresh() {
  if (!native || closed) return
  try { options.value = await settings.read() } catch { options.value = { eligible: false,onStart: false,onResume: false }; error.value = 'localOrNetworkError' }
  finally { loading.value = false }
}
async function change(key: 'onStart' | 'onResume', value: boolean) {
  if (loading.value || saving.value) return
  saving.value = true; error.value = ''
  try {
    const latest = await settings.read()
    await settings.configure({ onStart: latest.onStart,onResume: latest.onResume,[key]: value })
  } catch (cause) { error.value = cause instanceof SyncClientError ? cause.code : 'localOrNetworkError' }
  finally { await refresh(); saving.value = false }
}
onMounted(refresh)
// Consent/binding can change inside the neighboring settings panel.
const timer = native ? setInterval(() => { if (!loading.value && !saving.value) void refresh() },2000) : null
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
