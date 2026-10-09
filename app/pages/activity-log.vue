<template>
  <main id="main-content" tabindex="-1" class="page-shell">
    <header class="space-y-4">
      <NuxtLink :to="backTo" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>
      <h1 class="text-3xl font-bold">{{ $t('activities.add') }}</h1>
    </header>
    <p v-if="loadError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ loadError }}</p>
    <p v-else-if="!ready" role="status">{{ $t('common.loading') }}</p>
    <p v-else-if="!validProfile" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ $t('activities.profileUnavailable') }}</p>
    <ActivityEntry v-else :key="selectedProfileId ?? 'all'" :profile-id="selectedProfileId ?? undefined" class="entry-panel" />
  </main>
</template>
<script setup lang="ts">
import { activityProfileFromQuery } from '../utils/activity-entry-route'
import { validationMessage } from '../../shared/domain/validation'
const route = useRoute()
const { t } = useI18n()
const { profiles, refreshProfiles } = useProfiles()
const ready = ref(false), loadError = ref('')
const selectedProfileId = computed(() => activityProfileFromQuery(route.query.profile))
const profile = computed(() => profiles.value.find(p => p.id === selectedProfileId.value))
const validProfile = computed(() => selectedProfileId.value === undefined || (selectedProfileId.value !== null && Boolean(profile.value)))
const backTo = computed(() => profile.value ? `/dashboard/${profile.value.id}` : '/')
onMounted(async () => {
  try { await refreshProfiles(); ready.value = true }
  catch (cause) { loadError.value = validationMessage(cause, t) }
})
</script>
