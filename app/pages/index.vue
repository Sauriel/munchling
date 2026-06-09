<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-5">
      <div class="flex items-center gap-3">
        <div class="grid size-14 place-items-center rounded-2xl bg-munchling-600 text-white shadow-lg shadow-munchling-600/25">
          <Icon name="ph:bowl-food-duotone" class="size-8" />
        </div>
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
            {{ $t('app.name') }}
          </p>
          <h1 class="text-2xl font-bold tracking-tight">
            {{ $t('dashboard.title') }}
          </h1>
        </div>
      </div>

      <label class="block space-y-2">
        <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ $t('profiles.currentProfile') }}</span>
        <select
          v-model.number="selectedProfileModel"
          class="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-900"
        >
          <option :value="null" disabled>{{ $t('profiles.noProfile') }}</option>
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}
          </option>
        </select>
      </label>

      <NuxtLink to="/log" class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-5 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98]">
        <Icon name="ph:plus-circle-duotone" class="size-5" />
        {{ $t('mealLog.actions.create') }}
      </NuxtLink>
    </header>

    <section v-if="!currentProfile" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('dashboard.noProfile') }}</p>
      <NuxtLink to="/profiles" class="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-munchling-600 px-5 text-sm font-semibold text-white">
        {{ $t('profiles.actions.create') }}
      </NuxtLink>
    </section>

    <template v-else>
      <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">{{ $t('dashboard.today') }}</h2>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ formattedToday }}</p>
          </div>
          <div class="text-right">
            <p class="text-3xl font-bold">{{ todayNutrition.calories }}</p>
            <p class="text-xs text-slate-500">/ {{ currentProfile.dailyCaloriesTarget }} kcal</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <article v-for="target in dailyTargets" :key="target.key" class="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t(target.label) }}</p>
                <p class="mt-1 font-semibold">{{ target.consumed }}{{ target.unit }}</p>
                <p class="text-xs text-slate-400">/ {{ target.target }}{{ target.unit }}</p>
              </div>
              <svg class="size-14 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" class="fill-none stroke-slate-200 dark:stroke-slate-800" stroke-width="5" />
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  class="fill-none stroke-munchling-600"
                  stroke-width="5"
                  stroke-linecap="round"
                  :stroke-dasharray="`${Math.min(target.percent, 100) * 1.13} 113`"
                />
              </svg>
            </div>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div class="h-full rounded-full bg-munchling-600" :style="{ width: `${Math.min(target.percent, 100)}%` }" />
            </div>
            <p class="mt-1 text-right text-xs font-semibold text-slate-500">{{ target.percent }}%</p>
          </article>
        </div>
      </section>

      <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">{{ $t('dashboard.calorieHistory') }}</h2>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ $t('dashboard.lastDays') }}</p>
          </div>
          <Icon name="ph:chart-line-up-duotone" class="size-7 text-munchling-600" />
        </div>

        <svg class="h-48 w-full overflow-visible" viewBox="0 0 320 160" role="img" :aria-label="$t('dashboard.calorieHistory')">
          <line x1="8" y1="128" x2="312" y2="128" class="stroke-slate-200 dark:stroke-slate-800" stroke-width="2" />
          <line
            v-if="currentProfile.dailyCaloriesTarget > 0"
            x1="8"
            :y1="calorieTargetY"
            x2="312"
            :y2="calorieTargetY"
            class="stroke-munchling-600/40"
            stroke-width="2"
            stroke-dasharray="4 4"
          />
          <polyline :points="calorieLinePoints" fill="none" class="stroke-munchling-600" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
          <circle v-for="point in calorieChartPoints" :key="point.date" :cx="point.x" :cy="point.y" r="4" class="fill-munchling-600" />
          <text v-for="point in calorieChartPoints" :key="`${point.date}-label`" :x="point.x" y="150" text-anchor="middle" class="fill-slate-500 text-[10px]">
            {{ point.label }}
          </text>
        </svg>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">{{ $t('dashboard.todaysMeals') }}</h2>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ mealLogs.length }}</span>
        </div>

        <div v-if="isLoading" class="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          {{ $t('common.loading') }}
        </div>
        <div v-else-if="mealLogs.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {{ $t('dashboard.noMeals') }}
        </div>

        <article v-for="mealLog in mealLogs" v-else :key="mealLog.id" class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">{{ mealLog.sourceName }}</h3>
              <p class="text-sm text-slate-500 dark:text-slate-400">
                {{ formatTime(mealLog.loggedAt) }} · {{ profilePortion(mealLog) }}g
              </p>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right dark:bg-slate-950">
              <p class="text-lg font-bold">{{ calculateMealLogProfileNutrition(mealLog, currentProfile.id).calories }}</p>
              <p class="text-xs text-slate-500">kcal</p>
            </div>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <NuxtLink :to="`/log?edit=${mealLog.id}`" class="min-h-11 rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {{ $t('common.edit') }}
            </NuxtLink>
            <button type="button" class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeMealLog(mealLog.id)">
              {{ $t('common.delete') }}
            </button>
          </div>
        </article>
      </section>
    </template>

    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useCurrentProfile } from '~/composables/useCurrentProfile'
import { useMealLogs } from '~/composables/useMealLogs'
import { useProfiles } from '~/composables/useProfiles'
import { calculateMealLogProfileNutrition, listMealLogs, type MealLog, type NutritionValues } from '~/utils/database/repositories'

const { profiles, refreshProfiles } = useProfiles()
const { mealLogs, isLoading, refreshMealLogs, deleteMealLog } = useMealLogs()
const { currentProfileId, currentProfile, selectProfile, initializeCurrentProfile } = useCurrentProfile()

const history = ref<Array<{ date: string; label: string; calories: number }>>([])

const selectedProfileModel = computed({
  get: () => currentProfileId.value,
  set: (profileId) => selectProfile(profileId)
})

const todayDate = computed(() => dateKey(new Date()))
const formattedToday = computed(() => new Date().toLocaleDateString())

const emptyNutrition = (): NutritionValues => ({ calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 })

const todayNutrition = computed(() => {
  const profile = currentProfile.value
  const total = emptyNutrition()

  if (!profile) return total

  for (const mealLog of mealLogs.value) {
    const nutrition = calculateMealLogProfileNutrition(mealLog, profile.id)
    total.calories += nutrition.calories
    total.fat += nutrition.fat
    total.carbs += nutrition.carbs
    total.sugar += nutrition.sugar
    total.fiber += nutrition.fiber
    total.protein += nutrition.protein
    total.salt += nutrition.salt
  }

  return roundNutrition(total)
})

const dailyTargets = computed(() => {
  const profile = currentProfile.value
  if (!profile) return []

  return [
    { key: 'calories', label: 'dashboard.targets.calories', consumed: todayNutrition.value.calories, target: profile.dailyCaloriesTarget, unit: ' kcal' },
    { key: 'protein', label: 'dashboard.targets.protein', consumed: todayNutrition.value.protein, target: profile.dailyProteinTarget ?? 0, unit: 'g' },
    { key: 'carbs', label: 'dashboard.targets.carbs', consumed: todayNutrition.value.carbs, target: profile.dailyCarbsTarget ?? 0, unit: 'g' },
    { key: 'fat', label: 'dashboard.targets.fat', consumed: todayNutrition.value.fat, target: profile.dailyFatTarget ?? 0, unit: 'g' },
    { key: 'sugar', label: 'dashboard.targets.sugar', consumed: todayNutrition.value.sugar, target: profile.dailySugarTarget ?? 0, unit: 'g' },
    { key: 'fiber', label: 'dashboard.targets.fiber', consumed: todayNutrition.value.fiber, target: profile.dailyFiberTarget ?? 0, unit: 'g' },
    { key: 'salt', label: 'dashboard.targets.salt', consumed: todayNutrition.value.salt, target: profile.dailySaltTarget ?? 0, unit: 'g' }
  ].map((target) => ({
    ...target,
    percent: target.target > 0 ? Math.round((target.consumed / target.target) * 100) : 0
  }))
})

const maxChartCalories = computed(() => {
  const target = currentProfile.value?.dailyCaloriesTarget ?? 0
  return Math.max(target, ...history.value.map((day) => day.calories), 1)
})

const calorieChartPoints = computed(() => {
  const count = Math.max(history.value.length - 1, 1)
  return history.value.map((day, index) => ({
    ...day,
    x: 16 + (index / count) * 288,
    y: 128 - (day.calories / maxChartCalories.value) * 104
  }))
})

const calorieLinePoints = computed(() => calorieChartPoints.value.map((point) => `${point.x},${point.y}`).join(' '))
const calorieTargetY = computed(() => 128 - ((currentProfile.value?.dailyCaloriesTarget ?? 0) / maxChartCalories.value) * 104)

function roundNutrition(values: NutritionValues): NutritionValues {
  return {
    calories: Math.round(values.calories),
    fat: Math.round(values.fat * 100) / 100,
    carbs: Math.round(values.carbs * 100) / 100,
    sugar: Math.round(values.sugar * 100) / 100,
    fiber: Math.round(values.fiber * 100) / 100,
    protein: Math.round(values.protein * 100) / 100,
    salt: Math.round(values.salt * 100) / 100
  }
}

function dateKey(date: Date) {
  const copy = new Date(date)
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset())
  return copy.toISOString().slice(0, 10)
}

function formatTime(value: string) {
  return new Date(value.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function profilePortion(mealLog: MealLog) {
  const profileId = currentProfile.value?.id
  return mealLog.profiles.find((profile) => profile.profileId === profileId)?.portionGrams ?? 0
}

async function removeMealLog(id: number) {
  if (!currentProfile.value) return
  await deleteMealLog(id, { profileId: currentProfile.value.id, date: todayDate.value })
  await refreshHistory()
}

async function refreshDashboard() {
  if (!currentProfile.value) return
  await refreshMealLogs({ profileId: currentProfile.value.id, date: todayDate.value })
  await refreshHistory()
}

async function refreshHistory() {
  const profile = currentProfile.value
  if (!profile) {
    history.value = []
    return
  }

  const days: Array<{ date: string; label: string; calories: number }> = []
  const now = new Date()

  for (let index = 6; index >= 0; index--) {
    const day = new Date(now)
    day.setDate(now.getDate() - index)
    const key = dateKey(day)
    const logs = await listMealLogs({ profileId: profile.id, date: key })
    const calories = logs.reduce((sum, log) => sum + calculateMealLogProfileNutrition(log, profile.id).calories, 0)
    days.push({ date: key, label: day.toLocaleDateString([], { weekday: 'short' }).slice(0, 2), calories })
  }

  history.value = days
}

watch(currentProfileId, async () => {
  await refreshDashboard()
})

onMounted(async () => {
  await refreshProfiles()
  await initializeCurrentProfile()
  await refreshDashboard()
})
</script>
