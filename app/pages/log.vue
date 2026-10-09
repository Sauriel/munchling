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

        <section class="space-y-3" :aria-busy="searching || importing">
          <label class="block space-y-1.5" for="meal-source-search">
            <span class="text-sm font-medium">{{ $t('mealLog.search.label') }}</span>
            <input id="meal-source-search" v-model="sourceQuery" type="search" autocomplete="off" class="field-input" :placeholder="$t('mealLog.search.placeholder')">
          </label>
          <p v-if="selectedSource" class="rounded-2xl bg-munchling-50 p-3 text-sm dark:bg-munchling-600/10">
            {{ $t('mealLog.search.selected') }}: {{ selectedSource }}
            <button type="button" class="ml-2 min-h-11 px-2 font-semibold" @click="form.sourceId = null">{{ $t('common.cancel') }}</button>
          </p>
          <div class="max-h-80 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
            <section v-for="group in sourceGroups" :key="group.type" class="space-y-1">
              <h3 class="text-xs font-semibold uppercase text-slate-500">{{ $t(group.label) }}</h3>
              <button v-for="item in group.items" :key="`${group.type}:${item.id}`" type="button" class="block min-h-11 w-full rounded-xl px-3 py-2 text-left hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-munchling-600 disabled:opacity-60 dark:hover:bg-slate-800" :disabled="importing || isSaving" @click="selectSource(group.type, item)">
                {{ item.nameDe }}<span v-if="'brand' in item && item.brand"> · {{ item.brand }}</span>
                <span v-if="group.type === 'bundled'" class="block text-xs text-slate-500">{{ $t('mealLog.search.import') }}</span>
              </button>
            </section>
            <p v-if="searching" role="status" class="text-sm text-slate-500">{{ $t('common.loading') }}</p>
            <p v-else-if="!sourceGroups.length" role="status" class="text-sm text-slate-500">{{ $t('mealLog.search.empty') }}</p>
            <p v-if="sourceQuery.trim().length < 2" class="text-xs text-slate-500">{{ $t('mealLog.search.minimum') }}</p>
          </div>
          <p v-if="searchError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ $t('mealLog.search.failed') }}</p>
        </section>

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
        <p v-if="formError" role="alert" class="text-sm text-red-700 dark:text-red-300">{{ formError }}</p>
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
import { validationMessage } from '../../shared/domain/validation'
import { useFoods } from '~/composables/useFoods'
import { useMealLogs } from '~/composables/useMealLogs'
import { useProfiles } from '~/composables/useProfiles'
import { useRecipes } from '~/composables/useRecipes'
import { useBundledFoodSearch, type BundledFoodSearchResult } from '~/composables/useBundledFoodSearch'
import { mealSourceMatches } from '~/utils/meal-source-search'
import type { Food, Recipe, MealLog, NutritionValues, RecipeNutrition } from '../../shared/domain/types'

const route = useRoute()
const { t } = useI18n()
const { foods, refreshFoods, createFood } = useFoods()
const { searchBundledFoods, bundledFoodSearchError } = useBundledFoodSearch()
const { recipes, refreshRecipes, calculateRecipeNutrition } = useRecipes()
const { profiles, refreshProfiles } = useProfiles()
const { mealLogs, isLoading, refreshMealLogs, createMealLog, updateMealLog, deleteMealLog } = useMealLogs()

const isSaving = ref(false)
const formError = ref('')
const editingMealLogId = ref<number | null>(null)
const editingRevision = ref<number>()
const isEditing = computed(() => editingMealLogId.value !== null)
const profilePortions = reactive<Record<number, number>>({})
const recipeNutritionMap = reactive<Record<number, RecipeNutrition>>({})

const form = reactive({
  loggedAt: '',
  sourceType: 'food' as 'food' | 'recipe',
  sourceId: null as number | null
})

const emptyNutrition = (): NutritionValues => ({ calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 })

const sourceQuery = ref('')
const bundledResults = ref<BundledFoodSearchResult[]>([])
const searching = ref(false)
const searchError = ref(false)
const importing = ref(false)
let searchVersion = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
const sourceGroups = computed(() => [
  { type: 'recipe' as const, label: 'mealLog.search.recipes', items: mealSourceMatches(recipes.value, sourceQuery.value) },
  { type: 'food' as const, label: 'mealLog.search.foods', items: mealSourceMatches(foods.value, sourceQuery.value) },
  { type: 'bundled' as const, label: 'mealLog.search.database', items: bundledResults.value }
].filter(group => group.items.length))
const selectedSource = computed(() => {
  const source = form.sourceType === 'food' ? foods.value.find(item => item.id === form.sourceId) : recipes.value.find(item => item.id === form.sourceId)
  return source ? `${t(`mealLog.sourceTypes.${form.sourceType}`)} · ${source.nameDe}` : ''
})
watch(sourceQuery, query => {
  const version = ++searchVersion
  clearTimeout(searchTimer)
  bundledResults.value = []; searchError.value = false; searching.value = false
  if (query.trim().length < 2) return
  searching.value = true
  searchTimer = setTimeout(async () => {
    const results = await searchBundledFoods(query)
    if (version !== searchVersion) return
    bundledResults.value = results; searchError.value = Boolean(bundledFoodSearchError.value); searching.value = false
  }, 250)
})
onBeforeUnmount(() => { searchVersion++; clearTimeout(searchTimer) })
async function selectSource(type: 'food' | 'recipe' | 'bundled', item: Food | Recipe | BundledFoodSearchResult) {
  if (importing.value || isSaving.value) return
  formError.value = ''
  if (type !== 'bundled') { form.sourceType = type; form.sourceId = item.id; return }
  importing.value = true
  try {
    const source = item as BundledFoodSearchResult
    // The button explicitly imports a household food. Catalog IDs are not
    // household IDs; do not silently merge different foods by their names.
    const food = await createFood({
      nameDe: source.nameDe, nameEn: source.nameEn || source.nameDe, isCustom: false,
      caloriesPer100g: source.caloriesPer100g, fatPer100g: source.fatPer100g,
      carbsPer100g: source.carbsPer100g, sugarPer100g: source.sugarPer100g,
      fiberPer100g: source.fiberPer100g, proteinPer100g: source.proteinPer100g, saltPer100g: source.saltPer100g
    })
    if (!food) throw new Error('Food import returned no record')
    await refreshFoods('')
    form.sourceType = 'food'; form.sourceId = food.id
  } catch (error) { formError.value = validationMessage(error, t) }
  finally { importing.value = false }
}

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
const canSubmit = computed(() => Boolean(selectedSource.value) && totalWeightGrams.value > 0 && !importing.value)

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
  sourceQuery.value = ''
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
  formError.value = ''
  if (!canSubmit.value) return
  isSaving.value = true

  try {
    if (editingMealLogId.value) {
      await updateMealLog(editingMealLogId.value, mealLogInput(), {}, editingRevision.value)
    } else {
      await createMealLog(mealLogInput())
    }

    resetForm()
  } catch (error) {
    formError.value = validationMessage(error, t)
  } finally {
    isSaving.value = false
  }
}

function editMealLog(mealLog: MealLog) {
  editingMealLogId.value = mealLog.id
  editingRevision.value = mealLog.revision
  form.loggedAt = toInputDateTime(mealLog.loggedAt)
  form.sourceType = mealLog.sourceType
  form.sourceId = mealLog.foodId ?? mealLog.recipeId
  resetProfilePortions()
  for (const profile of mealLog.profiles) profilePortions[profile.profileId] = profile.portionGrams
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function removeMealLog(mealLog: MealLog) {
  if (!confirm(t('mealLog.confirmDelete', { name: mealLog.sourceName }))) return
  try { await deleteMealLog(mealLog.id, {}, mealLog.revision) }
  catch (error) { formError.value = validationMessage(error, t); window.scrollTo({ top: 0, behavior: 'smooth' }) }
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
  await Promise.all([refreshFoods(''), refreshRecipes(), refreshProfiles()])
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
