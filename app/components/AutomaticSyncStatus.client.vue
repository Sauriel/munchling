<template>
  <aside v-if="native && (status.busy || status.error)" role="status" class="app-alert rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p>{{ status.busy ? $t('settings.syncAutomatic.running') : $t('settings.syncAutomatic.failed', { code: status.error }) }}</p>
    <NuxtLink to="/settings" class="inline-flex min-h-11 items-center underline">{{ $t('nav.settings') }}</NuxtLink>
  </aside>
</template>
<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
const native = Capacitor.isNativePlatform()
const status = useState('automatic-sync-status', () => ({ busy: false,error: '',completed: false }))
</script>
