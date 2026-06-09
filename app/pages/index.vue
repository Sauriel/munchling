<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-12">
    <header class="space-y-5">
      <div class="flex items-center gap-3">
        <img src="/munchling_768.png" alt="" class="size-14 rounded-2xl shadow-lg shadow-munchling-600/25">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
            {{ $t('app.name') }}
          </p>
          <h1 class="text-2xl font-bold tracking-tight">
            {{ $t('dashboard.title') }}
          </h1>
        </div>
      </div>

      <NuxtLink to="/log" class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-5 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98]">
        <Icon name="ph:plus-circle-duotone" class="size-5" />
        {{ $t('mealLog.actions.create') }}
      </NuxtLink>
    </header>

    <section v-if="profiles.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('dashboard.noProfile') }}</p>
      <NuxtLink to="/profiles" class="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-munchling-600 px-5 text-sm font-semibold text-white">
        {{ $t('profiles.actions.create') }}
      </NuxtLink>
    </section>

    <section v-else class="space-y-3">
      <NuxtLink
        v-for="profile in profiles"
        :key="profile.id"
        :to="`/dashboard/${profile.id}`"
        class="block rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="truncate text-lg font-semibold">{{ profile.name }}</p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{{ $t('dashboard.today') }}</p>
            <p class="mt-3 text-3xl font-bold tracking-tight">
              {{ profileTodayCalories(profile.id) }}
              <span class="text-sm font-semibold text-slate-400">/ {{ profile.dailyCaloriesTarget }} kcal</span>
            </p>
          </div>

          <div class="relative grid size-24 shrink-0 place-items-center">
            <svg class="absolute inset-0 size-24 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="18" class="fill-none stroke-slate-200 dark:stroke-slate-800" stroke-width="5" />
              <circle
                cx="22"
                cy="22"
                r="18"
                class="fill-none stroke-munchling-600"
                stroke-width="5"
                stroke-linecap="round"
                :stroke-dasharray="`${Math.min(profileCaloriePercent(profile), 100) * 1.13} 113`"
              />
            </svg>
            <span class="text-sm font-bold text-munchling-700 dark:text-munchling-500">{{ profileCaloriePercent(profile) }}%</span>
          </div>
        </div>
      </NuxtLink>
    </section>

    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useProfiles } from '~/composables/useProfiles'
import { calculateMealLogProfileNutrition, listMealLogs, type Profile } from '~/utils/database/repositories'

const { profiles, refreshProfiles } = useProfiles()
const todayCaloriesByProfile = reactive<Record<number, number>>({})

const todayDate = computed(() => dateKey(new Date()))

function dateKey(date: Date) {
  const copy = new Date(date)
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset())
  return copy.toISOString().slice(0, 10)
}

function profileTodayCalories(profileId: number) {
  return todayCaloriesByProfile[profileId] ?? 0
}

function profileCaloriePercent(profile: Profile) {
  return profile.dailyCaloriesTarget > 0
    ? Math.round((profileTodayCalories(profile.id) / profile.dailyCaloriesTarget) * 100)
    : 0
}

async function refreshProfileCards() {
  for (const profile of profiles.value) {
    const logs = await listMealLogs({ profileId: profile.id, date: todayDate.value })
    todayCaloriesByProfile[profile.id] = Math.round(
      logs.reduce((sum, log) => sum + calculateMealLogProfileNutrition(log, profile.id).calories, 0)
    )
  }
}

onMounted(async () => {
  await refreshProfiles()
  await refreshProfileCards()
})
</script>
