<template>
  <section v-if="native" class="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" :aria-busy="busy">
    <h2 class="font-semibold">{{ $t('settings.syncPreparation.title') }}</h2>
    <p class="text-sm">{{ $t('settings.syncPreparation.scope') }}</p>
    <p class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{{ $t('settings.syncPreparation.security') }}</p>
    <label class="flex min-h-11 items-center gap-3 text-sm"><input v-model="secure" type="checkbox" :disabled="busy" class="size-5">{{ $t('settings.syncPreparation.secure') }}</label>
    <label for="sync-server" class="block text-sm font-semibold">{{ $t('settings.syncPreparation.address') }}</label>
    <input id="sync-server" v-model="address" type="url" inputmode="url" placeholder="https://munchling.example.org" :disabled="busy || !!progress" class="min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 dark:border-slate-700">
    <button type="button" :disabled="busy || !secure || !!progress" class="min-h-11 w-full rounded-xl bg-munchling-600 px-3 font-semibold text-white disabled:opacity-50" @click="inspect">{{ $t('settings.syncPreparation.inspect') }}</button>
    <div v-if="info" class="space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950">
      <h3 class="font-semibold">{{ $t('settings.syncPreparation.inventory') }}</h3>
      <p v-for="count in info.counts" :key="count.entity">{{ $t(`settings.syncPreparation.entities.${count.entity}`) }}: {{ $t('settings.syncPreparation.counts', { local: localCounts[count.entity] ?? 0, server: count.active }) }}</p>
      <button type="button" :disabled="busy || !secure || !!progress" class="min-h-11 rounded-xl bg-slate-200 px-3 disabled:opacity-50 dark:bg-slate-800" @click="download">{{ $t('settings.syncPreparation.download') }}</button>
    </div>
    <div v-if="progress" class="space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950">
      <p>{{ $t('settings.syncPreparation.progress', { done: progress.row.next_page, total: progress.manifest.pageCount }) }}</p>
      <p v-if="validated">{{ $t('settings.syncPreparation.validated') }}</p>
      <button type="button" :disabled="busy || !secure" class="min-h-11 rounded-xl bg-slate-200 px-3 disabled:opacity-50 dark:bg-slate-800" @click="download">{{ $t('settings.syncPreparation.resume') }}</button>
      <button type="button" :disabled="busy" class="ml-2 min-h-11 rounded-xl px-3 disabled:opacity-50" @click="discard">{{ $t('settings.syncPreparation.discard') }}</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-if="busy" role="status" class="text-sm">{{ $t('common.loading') }}</p>
  </section>
</template>
<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { databaseSql } from '~/utils/database/sql'
import { createSnapshotStaging } from '~/utils/sync/staging'
import { createSyncHttpClient } from '~/utils/sync/http'
import { SyncClientError } from '../../shared/domain/replies'
import type { ServerInfo } from '../../shared/domain/protocol'
const native = Capacitor.isNativePlatform(), { t } = useI18n(), stage = createSnapshotStaging(databaseSql)
const address = ref(''), secure = ref(false), busy = ref(false), error = ref(''), info = shallowRef<ServerInfo | null>(null), validated = ref(false)
const progress = shallowRef<Awaited<ReturnType<typeof stage.progress>>>(null), localCounts = ref<Record<string, number>>({})
async function action(run: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await run() } catch (cause) { error.value = t('settings.syncPreparation.failed', { code: cause instanceof SyncClientError ? cause.code : 'localOrNetworkError' }) }
  finally { busy.value = false }
}
async function inspect() {
  await action(async () => {
    if (!secure.value) return
    info.value = null
    if ((await stage.state()).seeded) throw new SyncClientError('developmentSeeded')
    const counts = await databaseSql.query<{ entity: string; active: number }>("SELECT 'profiles' AS entity,COUNT(*) AS active FROM profiles UNION ALL SELECT 'foods',COUNT(*) FROM foods UNION ALL SELECT 'recipes',COUNT(*) FROM recipes UNION ALL SELECT 'meal_logs',COUNT(*) FROM meal_logs UNION ALL SELECT 'recipe_ingredients',COUNT(*) FROM recipe_ingredients UNION ALL SELECT 'meal_log_profiles',COUNT(*) FROM meal_log_profiles;")
    localCounts.value = Object.fromEntries(counts.map(row => [row.entity, row.active]))
    info.value = await createSyncHttpClient(address.value).info()
  })
}
async function download() {
  await action(async () => {
    if (!secure.value) return
    validated.value = false
    let stored = await stage.audit()
    if (!stored) {
      if (!info.value) throw new SyncClientError('inspectFirst')
      const state = await stage.state(), client = createSyncHttpClient(address.value)
      const first = await client.startSnapshot({ serverInstanceId: info.value.serverInstanceId, serverEpoch: info.value.serverEpoch })
      try { await stage.begin(state.localEpoch, address.value, first) }
      catch (cause) { try { await client.releaseSnapshot(first) } catch { /* lease expires independently */ } throw cause }
      stored = await stage.audit()
    }
    if (!stored) throw new SyncClientError('downloadMissing')
    progress.value = stored
    const client = createSyncHttpClient(stored.row.server_url)
    // Binding metadata only in URLs; never serialize whole snapshot pages.
    const manifest = stored.manifest
    for (let page = stored.row.next_page; page < stored.manifest.pageCount; page++) {
      await stage.save(await client.snapshotPage(manifest, page))
      progress.value = await stage.progress()
    }
    await stage.complete(); validated.value = true
    // No adoption, push or enabled flag changes from this preparation screen.
    try { await client.releaseSnapshot(manifest) } catch { /* best effort, durable local pages remain */ }
  })
}
async function discard() { await action(async () => { await stage.discard(); progress.value = null; validated.value = false; info.value = null }) }
watch(address, () => { info.value = null })
onMounted(async () => { if (native) await action(async () => { progress.value = await stage.progress(); if (progress.value) address.value = progress.value.row.server_url }) })
</script>
