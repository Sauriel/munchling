<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('mealLog.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('mealLog.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('mealLog.description') }}
        </p>
      </div>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ isEditing ? $t('mealLog.form.editTitle') : $t('mealLog.form.createTitle') }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('mealLog.form.hint') }}
          </p>
        </div>
        <button v-if="isEditing" type="button" class="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 dark:text-slate-300" @click="resetForm">
          {{ $t('common.cancel') }}
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="submitForm">
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('mealLog.fields.loggedAt') }}</span>
          <input v-model="form.loggedAt" type="datetime-local" class="field-input">
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('mealLog.fields.sourceType') }}</span>
            <select v-model="form.sourceType" class="field-input" @change="form.sourceId = null">
              <option value="food">{{ $t('mealLog.sourceTypes.food') }}</option>
              <option value="recipe">{{ $t('mealLog.sourceTypes.recipe') }}</option>
            </select>
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('mealLog.fields.source') }}</span>
            <select v-model.number="form.sourceId" required class="field-input">
              <option :value="null" disabled>{{ $t('mealLog.placeholders.source') }}</option>
              <option v-for="option in sourceOptions" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
          </label>
        </div>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">{{ $t('mealLog.portions.title') }}</h3>
            <span class="text-sm font-semibold text-slate-500">{{ totalWeightGrams }}g</span>
          </div>

          <div v-if="profiles.length === 0" class="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
            {{ $t('mealLog.portions.noProfiles') }}
          </div>

          <label v-for="profile in profiles" :key="profile.id" class="grid grid-cols-[1fr_8rem] items-center gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <span>
              <span class="block font-medium">{{ profile.name }}</span>
              <span class="text-xs text-slate-500">{{ profile.dailyCaloriesTarget }} kcal</span>
            </span>
            <input
              v-model.number="profilePortions[profile.id]"
              min="0"
              step="1"
              inputmode="decimal"
              type="number"
              class="field-input text-right"
              :placeholder="$t('mealLog.portions.grams')"
            >
          </label>
        </section>

        <section class="rounded-2xl bg-munchling-50 p-4 dark:bg-munchling-600/10">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-semibold text-munchling-700 dark:text-munchling-500">{{ $t('mealLog.nutrition.preview') }}</h3>
            <span class="text-sm text-munchling-700 dark:text-munchling-500">{{ totalWeightGrams }}g</span>
          </div>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <div v-for="item in nutritionSummary(totalNutrition)" :key="item.label" class="rounded-xl bg-white/70 p-2 dark:bg-slate-950/60">
              <dt class="text-xs text-slate-500">{{ $t(item.label) }}</dt>
              <dd class="font-semibold">{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <button type="submit" class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-4 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98] disabled:opacity-60" :disabled="isSaving || !canSubmit">
          <Icon :name="isEditing ? 'ph:check-circle-duotone' : 'ph:plus-circle-duotone'" class="size-5" />
          {{ isEditing ? $t('mealLog.actions.save') : $t('mealLog.actions.create') }}
        </button>
      </form>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ $t('mealLog.listTitle') }}</h2>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ mealLogs.length }}</span>
      </div>

      <div v-if="isLoading" class="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        {{ $t('common.loading') }}
      </div>
      <div v-else-if="mealLogs.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        {{ $t('mealLog.empty') }}
      </div>

      <article v-for="mealLog in mealLogs" v-else :key="mealLog.id" class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-semibold">{{ mealLog.sourceName }}</h3>
              <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {{ $t(`mealLog.sourceTypes.${mealLog.sourceType}`) }}
              </span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400">
              {{ formatDate(mealLog.loggedAt) }} · {{ mealLog.totalWeightGrams }}g
            </p>
            <p class="mt-1 text-xs text-slate-400">
              {{ mealLog.profiles.map((profile) => `${profile.profileName}: ${profile.portionGrams}g`).join(' · ') }}
            </p>
          </div>
          <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right dark:bg-slate-950">
            <p class="text-lg font-bold">{{ scaleNutrition(mealLog.nutritionPer100g, mealLog.totalWeightGrams).calories }}</p>
            <p class="text-xs text-slate-500">kcal</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button type="button" class="min-h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" @click="editMealLog(mealLog)">
            {{ $t('common.edit') }}
          </button>
          <button type="button" class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeMealLog(mealLog)">
            {{ $t('common.delete') }}
          </button>
        </div>
      </article>
    </section>
    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useFoods } from '~/composables/useFoods'
import { useMealLogs } from '~/composables/useMealLogs'
import { useProfiles } from '~/composables/useProfiles'
import { useRecipes } from '~/composables/useRecipes'
import type { MealLog, NutritionValues, RecipeNutrition } from '~/utils/database/repositories'

const route = useRoute()
const { t } = useI18n()
const { foods, refreshFoods } = useFoods()
const { recipes, refreshRecipes, calculateRecipeNutrition } = useRecipes()
const { profiles, refreshProfiles } = useProfiles()
const { mealLogs, isLoading, refreshMealLogs, createMealLog, updateMealLog, deleteMealLog } = useMealLogs()

const isSaving = ref(false)
const editingMealLogId = ref<number | null>(null)
const isEditing = computed(() => editingMealLogId.value !== null)
const profilePortions = reactive<Record<number, number>>({})
const recipeNutritionMap = reactive<Record<number, RecipeNutrition>>({})

const form = reactive({
  loggedAt: '',
  sourceType: 'food' as 'food' | 'recipe',
  sourceId: null as number | null
})

const emptyNutrition = (): NutritionValues => ({ calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 })

const sourceOptions = computed(() => {
  if (form.sourceType === 'food') {
    return foods.value.map((food) => ({ id: food.id, name: `${food.nameDe}${food.brand ? ` · ${food.brand}` : ''}` }))
  }

  return recipes.value.map((recipe) => ({ id: recipe.id, name: recipe.nameDe }))
})

const totalWeightGrams = computed(() => {
  return Math.round(Object.values(profilePortions).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) * 100) / 100
})

const sourceNutrition = computed<NutritionValues>(() => {
  if (!form.sourceId) return emptyNutrition()

  if (form.sourceType === 'food') {
    const food = foods.value.find((item) => item.id === form.sourceId)
    return food
      ? {
          calories: food.caloriesPer100g,
          fat: food.fatPer100g,
          carbs: food.carbsPer100g,
          sugar: food.sugarPer100g,
          fiber: food.fiberPer100g,
          protein: food.proteinPer100g,
          salt: food.saltPer100g
        }
      : emptyNutrition()
  }

  return recipeNutritionMap[form.sourceId]?.per100g ?? emptyNutrition()
})

const totalNutrition = computed(() => scaleNutrition(sourceNutrition.value, totalWeightGrams.value))
const canSubmit = computed(() => Boolean(form.sourceId) && totalWeightGrams.value > 0)

function scaleNutrition(values: NutritionValues, grams: number): NutritionValues {
  const factor = grams / 100
  return {
    calories: Math.round(values.calories * factor),
    fat: Math.round(values.fat * factor * 100) / 100,
    carbs: Math.round(values.carbs * factor * 100) / 100,
    sugar: Math.round(values.sugar * factor * 100) / 100,
    fiber: Math.round(values.fiber * factor * 100) / 100,
    protein: Math.round(values.protein * factor * 100) / 100,
    salt: Math.round(values.salt * factor * 100) / 100
  }
}

function nutritionSummary(values: NutritionValues) {
  return [
    { label: 'mealLog.nutrition.calories', value: `${values.calories} kcal` },
    { label: 'mealLog.nutrition.protein', value: `${values.protein}g` },
    { label: 'mealLog.nutrition.carbs', value: `${values.carbs}g` },
    { label: 'mealLog.nutrition.fat', value: `${values.fat}g` },
    { label: 'mealLog.nutrition.sugar', value: `${values.sugar}g` },
    { label: 'mealLog.nutrition.fiber', value: `${values.fiber}g` },
    { label: 'mealLog.nutrition.salt', value: `${values.salt}g` }
  ]
}

function nowForInput() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

function toSqlDateTime(value: string) {
  return value ? value.replace('T', ' ') : null
}

function toInputDateTime(value: string) {
  return value.replace(' ', 'T').slice(0, 16)
}

function resetProfilePortions() {
  for (const key of Object.keys(profilePortions)) delete profilePortions[Number(key)]
  for (const profile of profiles.value) profilePortions[profile.id] = 0
}

function resetForm() {
  form.loggedAt = nowForInput()
  form.sourceType = 'food'
  form.sourceId = null
  editingMealLogId.value = null
  resetProfilePortions()
}

function mealLogInput() {
  return {
    loggedAt: toSqlDateTime(form.loggedAt),
    foodId: form.sourceType === 'food' ? form.sourceId : null,
    recipeId: form.sourceType === 'recipe' ? form.sourceId : null,
    profiles: Object.entries(profilePortions)
      .map(([profileId, portionGrams]) => ({ profileId: Number(profileId), portionGrams: Number(portionGrams) || 0 }))
      .filter((profile) => profile.portionGrams > 0)
  }
}

async function submitForm() {
  if (!canSubmit.value) return
  isSaving.value = true

  try {
    if (editingMealLogId.value) {
      await updateMealLog(editingMealLogId.value, mealLogInput())
    } else {
      await createMealLog(mealLogInput())
    }

    resetForm()
  } finally {
    isSaving.value = false
  }
}

function editMealLog(mealLog: MealLog) {
  editingMealLogId.value = mealLog.id
  form.loggedAt = toInputDateTime(mealLog.loggedAt)
  form.sourceType = mealLog.sourceType
  form.sourceId = mealLog.foodId ?? mealLog.recipeId
  resetProfilePortions()
  for (const profile of mealLog.profiles) profilePortions[profile.profileId] = profile.portionGrams
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function removeMealLog(mealLog: MealLog) {
  if (!confirm(t('mealLog.confirmDelete', { name: mealLog.sourceName }))) return
  await deleteMealLog(mealLog.id)
}

function formatDate(value: string) {
  return new Date(value.replace(' ', 'T')).toLocaleString()
}

async function refreshRecipeNutrition() {
  for (const recipe of recipes.value) {
    try {
      recipeNutritionMap[recipe.id] = await calculateRecipeNutrition(recipe.id)
    } catch {
      recipeNutritionMap[recipe.id] = { totalWeightGrams: 0, total: emptyNutrition(), per100g: emptyNutrition() }
    }
  }
}

onMounted(async () => {
  await Promise.all([refreshFoods(), refreshRecipes(), refreshProfiles()])
  resetForm()
  await refreshRecipeNutrition()
  await refreshMealLogs()

  const editId = Number(route.query.edit)
  const mealLogToEdit = mealLogs.value.find((mealLog) => mealLog.id === editId)

  if (mealLogToEdit) {
    editMealLog(mealLogToEdit)
  }
})
</script>

<style scoped>
.field-input {
  @apply min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950;
}
</style>
