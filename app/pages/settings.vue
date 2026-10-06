<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('settings.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('settings.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('settings.description') }}
        </p>
      </div>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <NuxtLink to="/profiles" class="flex min-h-14 items-center justify-between rounded-2xl bg-slate-50 px-4 transition active:scale-[0.99] dark:bg-slate-950">
        <span class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-2xl bg-munchling-50 text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500">
            <Icon name="ph:users-duotone" class="size-6" />
          </span>
          <span>
            <span class="block font-semibold">{{ $t('settings.profiles.title') }}</span>
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ $t('settings.profiles.hint') }}</span>
          </span>
        </span>
        <Icon name="ph:caret-right" class="size-5 text-slate-400" />
      </NuxtLink>
    </section>


    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center gap-3">
        <div class="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Icon name="ph:moon-stars-duotone" class="size-6" />
        </div>
        <div>
          <h2 class="font-semibold">{{ $t('settings.theme.title') }}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('settings.theme.hint') }}</p>
        </div>
      </div>
      <p class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {{ $t('settings.theme.system') }}
      </p>
    </section>
    <section v-if="supported" class="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" :aria-busy="isBusy">
      <div>
        <h2 class="font-semibold">{{ $t('settings.backup.title') }}</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{{ $t('settings.backup.hint') }}</p>
      </div>
      <p class="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{{ $t('settings.backup.privacy') }}</p>
      <button type="button" :disabled="isBusy" class="min-h-11 w-full rounded-2xl bg-munchling-600 px-4 py-3 font-semibold text-white disabled:opacity-50" @click="exportCurrent">
        {{ $t('settings.backup.export') }}
      </button>
      <label class="block text-sm font-semibold" for="backup-file">{{ $t('settings.backup.import') }}</label>
      <input id="backup-file" type="file" accept="application/json,.json" :disabled="isBusy" class="block w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-slate-100 file:px-3 file:text-slate-700 disabled:opacity-50 dark:file:bg-slate-800 dark:file:text-slate-200" @change="onFileSelected">
      <div v-if="pendingBackup" class="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
        <p class="text-sm">{{ $t('settings.backup.summary', { profiles: pendingBackup.data.profiles.length, foods: pendingBackup.data.foods.length, recipes: pendingBackup.data.recipes.length, meals: pendingBackup.data.mealLogs.length }) }}</p>
        <p class="text-sm text-red-700 dark:text-red-300">{{ $t('settings.backup.replaceWarning') }}</p>
        <p v-if="pendingBackup.version === 1" class="text-sm text-amber-700 dark:text-amber-300">{{ $t('settings.backup.legacyWarning') }}</p>
        <label class="flex min-h-11 items-center gap-3 text-sm">
          <input v-model="confirmed" type="checkbox" :disabled="isBusy" class="size-5 shrink-0">
          {{ $t('settings.backup.confirm') }}
        </label>
        <div class="flex gap-3">
          <button type="button" :disabled="isBusy || !confirmed" class="min-h-11 flex-1 rounded-xl bg-red-600 px-3 font-semibold text-white disabled:opacity-50" @click="restore">
            {{ $t('settings.backup.restore') }}
          </button>
          <button type="button" :disabled="isBusy" class="min-h-11 rounded-xl bg-slate-200 px-3 dark:bg-slate-800" @click="pendingBackup = null">
            {{ $t('common.cancel') }}
          </button>
        </div>
      </div>
      <button v-if="recoveryAvailable" type="button" :disabled="isBusy" class="min-h-11 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold disabled:opacity-50 dark:bg-slate-800" @click="exportRecovery">
        {{ $t('settings.backup.exportRecovery') }}
      </button>
      <button v-if="migrationAvailable" type="button" :disabled="isBusy" class="min-h-11 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold disabled:opacity-50 dark:bg-slate-800" @click="exportMigration">
        {{ $t('settings.backup.exportMigration') }}
      </button>
      <p v-if="isBusy" role="status" class="text-sm text-slate-500">{{ $t('common.loading') }}</p>
      <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <p v-if="success" role="status" class="text-sm text-munchling-700 dark:text-munchling-500">{{ success }}</p>
    </section>
    <SyncPreparation />
    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useLocalBackups } from '~/composables/useLocalBackups'

const { supported, isBusy, error, success, pendingBackup, recoveryAvailable, migrationAvailable, exportCurrent, selectFile, restore, exportRecovery, exportMigration } = useLocalBackups()
const confirmed = ref(false)
watch(pendingBackup, () => { confirmed.value = false })

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await selectFile(file)
  input.value = ''
}
</script>
