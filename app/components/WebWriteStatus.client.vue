<template>
  <aside v-if="pending || readFailed" role="alert" class="app-alert space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
    <p>{{ $t(pending ? 'web.pendingWrite' : 'web.readFailed') }}</p>
    <button v-if="pending" :disabled="busy" class="min-h-11 rounded-lg border border-amber-700 px-3 py-2 disabled:opacity-50" @click="retry">{{ $t('web.retryWrite') }}</button>
    <p v-if="error">{{ error }}</p>
  </aside>
  <WebDataReview />
</template>
<script setup lang="ts">
import type { createHttpDataService } from '~/utils/data/http'
const service = useMunchlingData() as Partial<ReturnType<typeof createHttpDataService>>
const { t } = useI18n()
const pending = ref(false), readFailed = ref(false), busy = ref(false), error = ref('')
let timer: ReturnType<typeof setInterval> | undefined
function check() { readFailed.value = service.hasReadError?.() ?? false; try { pending.value = service.hasPendingWrite?.() ?? false } catch { pending.value = true; error.value = t('web.journalInvalid') } }
async function retry() {
  busy.value = true; error.value = ''
  try { await service.retryPendingWrite?.(); window.location.reload() }
  catch { error.value = t('web.retryFailed') }
  finally { busy.value = false; check() }
}
onMounted(() => { check(); timer = setInterval(check, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
