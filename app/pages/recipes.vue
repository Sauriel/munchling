<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('recipes.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('recipes.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('recipes.description') }}
        </p>
      </div>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ isEditing ? $t('recipes.form.editTitle') : $t('recipes.form.createTitle') }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('recipes.form.hint') }}
          </p>
        </div>
        <button
          v-if="isEditing"
          type="button"
          class="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 dark:text-slate-300"
          @click="resetForm"
        >
          {{ $t('common.cancel') }}
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="submitForm">
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('recipes.fields.name') }}</span>
          <input v-model="form.name" required class="field-input" :placeholder="$t('recipes.placeholders.name')">
        </label>

        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('recipes.fields.description') }}</span>
          <textarea v-model="form.description" class="field-input min-h-24 py-3" :placeholder="$t('recipes.placeholders.description')" />
        </label>


        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold">{{ $t('recipes.ingredients.title') }}</h3>
            <button type="button" class="min-h-10 rounded-full bg-slate-100 px-4 text-sm font-semibold dark:bg-slate-800" @click="addIngredientRow">
              {{ $t('recipes.ingredients.add') }}
            </button>
          </div>

          <div v-if="form.ingredients.length === 0" class="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
            {{ $t('recipes.ingredients.empty') }}
          </div>

          <div v-for="(ingredient, index) in form.ingredients" :key="ingredient.clientId" class="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <button type="button" class="flex min-h-11 w-full items-center justify-between gap-3 text-left" @click="ingredient.isExpanded = !ingredient.isExpanded">
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ ingredientHeader(ingredient, index) }}</span>
                <span class="text-xs text-slate-500">{{ ingredient.amountGrams }}g</span>
              </span>
              <Icon :name="ingredient.isExpanded ? 'ph:caret-up' : 'ph:caret-down'" class="size-5 shrink-0 text-slate-400" />
            </button>

            <div v-if="ingredient.isExpanded" class="space-y-3">
              <label class="block space-y-1.5">
                <span class="text-xs font-medium text-slate-500">{{ $t('recipes.ingredients.amount') }}</span>
                <input v-model.number="ingredient.amountGrams" required min="0.01" step="0.01" type="number" inputmode="decimal" class="field-input">
              </label>

              <section class="space-y-2">
                <div class="flex items-end gap-2">
                  <label class="block flex-1 space-y-1.5">
                    <span class="text-xs font-medium text-slate-500">{{ $t('recipes.ingredients.source') }}</span>
                    <input
                      v-model="ingredient.searchTerm"
                      class="field-input"
                      :placeholder="$t('recipes.ingredients.searchPlaceholder')"
                      @input="searchIngredientSources(ingredient)"
                    >
                  </label>
                  <button
                    type="button"
                    class="flex min-h-12 items-center justify-center rounded-2xl bg-slate-100 px-4 text-sm font-semibold dark:bg-slate-800"
                    :disabled="isScanning || isLookingUpProduct"
                    @click="scanIngredientEan(ingredient)"
                  >
                    <Icon name="ph:barcode-duotone" class="size-5" />
                  </button>
                </div>

                <button
                  type="button"
                  class="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                  :disabled="!ingredient.searchTerm.trim()"
                  @click="createMissingIngredient(ingredient)"
                >
                  <Icon name="ph:plus-circle-duotone" class="size-5" />
                  {{ $t('recipes.ingredients.createMissing') }}
                </button>

                <p v-if="selectedIngredientLabel(ingredient)" class="rounded-2xl bg-munchling-50 p-3 text-xs font-medium text-munchling-700 dark:bg-munchling-600/10 dark:text-munchling-500">
                  {{ $t('recipes.ingredients.selected') }}: {{ selectedIngredientLabel(ingredient) }}
                </p>

                <div v-if="ingredient.showResults && ingredientSearchResults(ingredient).length > 0" class="space-y-2">
                  <button
                    v-for="result in ingredientSearchResults(ingredient)"
                    :key="`${result.type}-${result.id}`"
                    type="button"
                    class="w-full rounded-2xl bg-white p-3 text-left text-sm shadow-sm dark:bg-slate-900"
                    @click="selectIngredientResult(ingredient, result)"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <p class="font-semibold">{{ result.name }}</p>
                        <p class="text-xs text-slate-500">{{ result.subtitle }}</p>
                      </div>
                      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold dark:bg-slate-800">{{ $t(result.labelKey) }}</span>
                    </div>
                  </button>
                </div>
              </section>

              <button type="button" class="min-h-10 w-full rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeIngredientRow(index)">
                {{ $t('recipes.ingredients.remove') }}
              </button>
            </div>
          </div>
        </section>

        <section class="rounded-2xl bg-munchling-50 p-4 dark:bg-munchling-600/10">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-semibold text-munchling-700 dark:text-munchling-500">{{ $t('recipes.nutrition.preview') }}</h3>
            <span class="text-sm text-munchling-700 dark:text-munchling-500">{{ formNutrition.totalWeightGrams }}g</span>
          </div>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <div v-for="item in nutritionSummary(formNutrition.per100g)" :key="item.label" class="rounded-xl bg-white/70 p-2 dark:bg-slate-950/60">
              <dt class="text-xs text-slate-500">{{ $t(item.label) }}</dt>
              <dd class="font-semibold">{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <button type="submit" class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-4 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98] disabled:opacity-60" :disabled="isSaving">
          <Icon :name="isEditing ? 'ph:check-circle-duotone' : 'ph:plus-circle-duotone'" class="size-5" />
          {{ isEditing ? $t('recipes.actions.save') : $t('recipes.actions.create') }}
        </button>
      </form>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ $t('recipes.listTitle') }}</h2>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ recipes.length }}</span>
      </div>

      <div v-if="isLoading" class="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        {{ $t('common.loading') }}
      </div>
      <div v-else-if="recipes.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        {{ $t('recipes.empty') }}
      </div>

      <article v-for="recipe in recipes" v-else :key="recipe.id" class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button type="button" class="flex min-h-11 w-full items-center justify-between gap-3 text-left" @click="toggleRecipe(recipe.id)">
          <span class="min-w-0 truncate text-lg font-semibold">{{ recipe.nameDe }}</span>
          <Icon :name="expandedRecipeId === recipe.id ? 'ph:caret-up' : 'ph:caret-down'" class="size-5 shrink-0 text-slate-400" />
        </button>

        <div v-if="expandedRecipeId === recipe.id" class="mt-4 space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p v-if="recipe.description" class="text-xs text-slate-400">{{ recipe.description }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right dark:bg-slate-950">
              <p class="text-lg font-bold">{{ recipeNutritionMap[recipe.id]?.per100g.calories ?? 0 }}</p>
              <p class="text-xs text-slate-500">kcal/100g</p>
            </div>
          </div>

          <dl class="grid grid-cols-3 gap-2 text-center text-xs">
            <div v-for="item in nutritionSummary(recipeNutritionMap[recipe.id]?.per100g)" :key="item.label" class="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
              <dt class="text-slate-500 dark:text-slate-400">{{ $t(item.label) }}</dt>
              <dd class="mt-1 font-semibold">{{ item.value }}</dd>
            </div>
          </dl>

          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="min-h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" @click="editRecipe(recipe)">
              {{ $t('common.edit') }}
            </button>
            <button type="button" class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeRecipe(recipe)">
              {{ $t('common.delete') }}
            </button>
          </div>
        </div>
      </article>
    </section>
    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useBarcodeScanner } from '~/composables/useBarcodeScanner'
import { useBundledFoodSearch, type BundledFoodSearchResult } from '~/composables/useBundledFoodSearch'
import { useFoods } from '~/composables/useFoods'
import { useOpenFoodFacts } from '~/composables/useOpenFoodFacts'
import { useRecipes } from '~/composables/useRecipes'
import type { Food, NutritionValues, Recipe, RecipeIngredientInput, RecipeNutrition } from '~/utils/database/repositories'

type IngredientRow = {
  clientId: string
  kind: 'food' | 'recipe'
  sourceId: number | null
  amountGrams: number
  searchTerm: string
  showResults: boolean
  isExpanded: boolean
}

type IngredientSearchResult = {
  type: 'food' | 'recipe' | 'bundled'
  id: number | string
  name: string
  subtitle: string
  labelKey: string
  food?: Food
  recipe?: Recipe
  bundledFood?: BundledFoodSearchResult
}

type RecipeForm = {
  name: string
  description: string
  ingredients: IngredientRow[]
}

const { t } = useI18n()
const { isScanning, scanEan } = useBarcodeScanner()
const { bundledFoodResults, searchBundledFoods } = useBundledFoodSearch()
const { isLookingUpProduct, lookupProductByEan } = useOpenFoodFacts()
const { foods, refreshFoods, createFood, getFoodByEan, getFoodByNameDe } = useFoods()
const { recipes, isLoading, refreshRecipes, loadRecipe, createRecipe, updateRecipe, deleteRecipe, calculateRecipeNutrition } = useRecipes()

const isSaving = ref(false)
const editingRecipeId = ref<number | null>(null)
const isEditing = computed(() => editingRecipeId.value !== null)
const recipeNutritionMap = reactive<Record<number, RecipeNutrition>>({})
const expandedRecipeId = ref<number | null>(null)

const emptyNutrition = (): NutritionValues => ({ calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 })
const emptyRecipeNutrition = (): RecipeNutrition => ({ totalWeightGrams: 0, total: emptyNutrition(), per100g: emptyNutrition() })

const emptyForm = (): RecipeForm => ({ name: '', description: '', ingredients: [] })
const form = reactive<RecipeForm>(emptyForm())

function nextClientId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizedIncludes(value: string, search: string) {
  return value.toLowerCase().includes(search.toLowerCase())
}

async function searchIngredientSources(ingredient: IngredientRow) {
  ingredient.sourceId = null
  ingredient.showResults = ingredient.searchTerm.trim().length >= 2
  if (ingredient.showResults) {
    await searchBundledFoods(ingredient.searchTerm)
  }
}

function ingredientSearchResults(ingredient: IngredientRow): IngredientSearchResult[] {
  const search = ingredient.searchTerm.trim()
  if (search.length < 2) return []

  const foodResults: IngredientSearchResult[] = foods.value
    .filter((food) => normalizedIncludes(`${food.nameDe} ${food.nameEn} ${food.brand ?? ''} ${food.ean ?? ''}`, search))
    .slice(0, 8)
    .map((food) => ({
      type: 'food',
      id: food.id,
      name: food.nameDe,
      subtitle: `${food.nameEn}${food.brand ? ` · ${food.brand}` : ''} · ${food.caloriesPer100g} kcal/100g`,
      labelKey: 'recipes.ingredients.food',
      food
    }))

  const recipeResults: IngredientSearchResult[] = recipes.value
    .filter((recipe) => recipe.id !== editingRecipeId.value)
    .filter((recipe) => normalizedIncludes(`${recipe.nameDe} ${recipe.nameEn} ${recipe.description ?? ''}`, search))
    .slice(0, 8)
    .map((recipe) => ({
      type: 'recipe',
      id: recipe.id,
      name: recipe.nameDe,
      subtitle: recipe.nameEn,
      labelKey: 'recipes.ingredients.recipe',
      recipe
    }))

  const bundledResults: IngredientSearchResult[] = bundledFoodResults.value
    .slice(0, 8)
    .map((food) => ({
      type: 'bundled',
      id: food.blsCode,
      name: food.nameDe,
      subtitle: `${food.nameEn} · ${food.caloriesPer100g} kcal/100g`,
      labelKey: 'recipes.ingredients.bundled',
      bundledFood: food
    }))

  return [...foodResults, ...recipeResults, ...bundledResults].slice(0, 20)
}

function selectedIngredientLabel(ingredient: IngredientRow) {
  if (!ingredient.sourceId) return ''

  if (ingredient.kind === 'food') {
    return foods.value.find((food) => food.id === ingredient.sourceId)?.nameDe ?? ''
  }

  return recipes.value.find((recipe) => recipe.id === ingredient.sourceId)?.nameDe ?? ''
}

function ingredientHeader(ingredient: IngredientRow, index: number) {
  return selectedIngredientLabel(ingredient) || ingredient.searchTerm.trim() || `${t('recipes.ingredients.source')} ${index + 1}`
}

function toggleRecipe(recipeId: number) {
  expandedRecipeId.value = expandedRecipeId.value === recipeId ? null : recipeId
}

async function createFoodFromBundled(food: BundledFoodSearchResult) {
  const existingFood = await getFoodByNameDe(food.nameDe)
  if (existingFood) return existingFood

  return await createFood({
    nameDe: food.nameDe,
    nameEn: food.nameEn,
    brand: 'BLS',
    ean: null,
    caloriesPer100g: food.caloriesPer100g,
    fatPer100g: food.fatPer100g,
    carbsPer100g: food.carbsPer100g,
    sugarPer100g: food.sugarPer100g,
    fiberPer100g: food.fiberPer100g,
    proteinPer100g: food.proteinPer100g,
    saltPer100g: food.saltPer100g,
    isCustom: false
  })
}

async function selectIngredientResult(ingredient: IngredientRow, result: IngredientSearchResult) {
  if (result.type === 'recipe' && result.recipe) {
    ingredient.kind = 'recipe'
    ingredient.sourceId = result.recipe.id
    ingredient.searchTerm = result.recipe.nameDe
    ingredient.showResults = false
    return
  }

  if (result.type === 'bundled' && result.bundledFood) {
    const food = await createFoodFromBundled(result.bundledFood)
    if (!food) return
    ingredient.kind = 'food'
    ingredient.sourceId = food.id
    ingredient.searchTerm = food.nameDe
    ingredient.showResults = false
    return
  }

  if (result.food) {
    ingredient.kind = 'food'
    ingredient.sourceId = result.food.id
    ingredient.searchTerm = result.food.nameDe
    ingredient.showResults = false
  }
}

async function createMissingIngredient(ingredient: IngredientRow) {
  const name = ingredient.searchTerm.trim()
  if (!name) return

  const existingFood = await getFoodByNameDe(name)
  const food = existingFood ?? await createFood({
    nameDe: name,
    nameEn: name,
    brand: null,
    ean: null,
    caloriesPer100g: 0,
    fatPer100g: 0,
    carbsPer100g: 0,
    sugarPer100g: 0,
    fiberPer100g: 0,
    proteinPer100g: 0,
    saltPer100g: 0,
    isCustom: true
  })

  if (!food) return

  ingredient.kind = 'food'
  ingredient.sourceId = food.id
  ingredient.searchTerm = food.nameDe
  ingredient.showResults = false
}

async function scanIngredientEan(ingredient: IngredientRow) {
  const ean = await scanEan(t('foods.scan.instructions'))
  if (!ean) return

  const existingFood = await getFoodByEan(ean)
  if (existingFood) {
    ingredient.kind = 'food'
    ingredient.sourceId = existingFood.id
    ingredient.searchTerm = existingFood.nameDe
    ingredient.showResults = false
    return
  }

  const product = await lookupProductByEan(ean)
  if (!product) return

  const existingNamedFood = await getFoodByNameDe(product.nameDe)
  const food = existingNamedFood ?? await createFood({ ...product, isCustom: false })
  if (!food) return

  ingredient.kind = 'food'
  ingredient.sourceId = food.id
  ingredient.searchTerm = food.nameDe
  ingredient.showResults = false
}

function addIngredientRow() {
  form.ingredients.push({ clientId: nextClientId(), kind: 'food', sourceId: null, amountGrams: 100, searchTerm: '', showResults: false, isExpanded: true })
}

function removeIngredientRow(index: number) {
  form.ingredients.splice(index, 1)
}

function resetForm() {
  Object.assign(form, emptyForm())
  editingRecipeId.value = null
}

async function editRecipe(recipe: Recipe) {
  const recipeWithIngredients = await loadRecipe(recipe.id)

  if (!recipeWithIngredients) return

  editingRecipeId.value = recipe.id
  Object.assign(form, {
    name: recipeWithIngredients.nameDe,
    description: recipeWithIngredients.description ?? '',
    ingredients: recipeWithIngredients.ingredients.map((ingredient) => ({
      clientId: nextClientId(),
      kind: ingredient.foodId ? 'food' : 'recipe',
      sourceId: ingredient.foodId ?? ingredient.subRecipeId,
      amountGrams: ingredient.amountGrams,
      searchTerm: '',
      showResults: false,
      isExpanded: false
    }))
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function toIngredientInputs(): RecipeIngredientInput[] {
  return form.ingredients
    .filter((ingredient) => ingredient.sourceId && ingredient.amountGrams > 0)
    .map((ingredient) => {
      if (ingredient.kind === 'food') {
        return { foodId: ingredient.sourceId as number, amountGrams: ingredient.amountGrams }
      }

      return { subRecipeId: ingredient.sourceId as number, amountGrams: ingredient.amountGrams }
    })
}

async function submitForm() {
  isSaving.value = true

  try {
    const input = {
      nameDe: form.name,
      nameEn: form.name,
      description: optionalText(form.description),
      isSubRecipe: false,
      ingredients: toIngredientInputs()
    }

    if (editingRecipeId.value) {
      await updateRecipe(editingRecipeId.value, input)
    } else {
      await createRecipe(input)
    }

    resetForm()
    await refreshRecipes()
    await refreshRecipeNutrition()
  } finally {
    isSaving.value = false
  }
}

async function removeRecipe(recipe: Recipe) {
  if (!confirm(t('recipes.confirmDelete', { name: recipe.nameDe }))) return

  await deleteRecipe(recipe.id)
  delete recipeNutritionMap[recipe.id]
  await refreshRecipeNutrition()
}

function addNutritionFromFood(total: NutritionValues, food: Food, amountGrams: number) {
  const factor = amountGrams / 100
  total.calories += food.caloriesPer100g * factor
  total.fat += food.fatPer100g * factor
  total.carbs += food.carbsPer100g * factor
  total.sugar += food.sugarPer100g * factor
  total.fiber += food.fiberPer100g * factor
  total.protein += food.proteinPer100g * factor
  total.salt += food.saltPer100g * factor
}

function addNutritionFromRecipe(total: NutritionValues, nutrition: RecipeNutrition, amountGrams: number) {
  const factor = amountGrams / 100
  total.calories += nutrition.per100g.calories * factor
  total.fat += nutrition.per100g.fat * factor
  total.carbs += nutrition.per100g.carbs * factor
  total.sugar += nutrition.per100g.sugar * factor
  total.fiber += nutrition.per100g.fiber * factor
  total.protein += nutrition.per100g.protein * factor
  total.salt += nutrition.per100g.salt * factor
}

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

const formNutrition = computed<RecipeNutrition>(() => {
  const total = emptyNutrition()
  let totalWeightGrams = 0

  for (const ingredient of form.ingredients) {
    if (!ingredient.sourceId || ingredient.amountGrams <= 0) continue

    totalWeightGrams += ingredient.amountGrams

    if (ingredient.kind === 'food') {
      const food = foods.value.find((item) => item.id === ingredient.sourceId)
      if (food) addNutritionFromFood(total, food, ingredient.amountGrams)
      continue
    }

    const nutrition = recipeNutritionMap[ingredient.sourceId]
    if (nutrition) addNutritionFromRecipe(total, nutrition, ingredient.amountGrams)
  }

  const per100g = emptyNutrition()
  if (totalWeightGrams > 0) {
    const factor = 100 / totalWeightGrams
    per100g.calories = total.calories * factor
    per100g.fat = total.fat * factor
    per100g.carbs = total.carbs * factor
    per100g.sugar = total.sugar * factor
    per100g.fiber = total.fiber * factor
    per100g.protein = total.protein * factor
    per100g.salt = total.salt * factor
  }

  return { totalWeightGrams: Math.round(totalWeightGrams * 100) / 100, total: roundNutrition(total), per100g: roundNutrition(per100g) }
})

function formatGram(value: number) {
  return `${value}g`
}

function nutritionSummary(values: NutritionValues = emptyNutrition()) {
  return [
    { label: 'recipes.nutrition.calories', value: `${values.calories} kcal` },
    { label: 'recipes.nutrition.protein', value: formatGram(values.protein) },
    { label: 'recipes.nutrition.carbs', value: formatGram(values.carbs) },
    { label: 'recipes.nutrition.fat', value: formatGram(values.fat) },
    { label: 'recipes.nutrition.sugar', value: formatGram(values.sugar) },
    { label: 'recipes.nutrition.fiber', value: formatGram(values.fiber) },
    { label: 'recipes.nutrition.salt', value: formatGram(values.salt) }
  ]
}

async function refreshRecipeNutrition() {
  for (const recipe of recipes.value) {
    try {
      recipeNutritionMap[recipe.id] = await calculateRecipeNutrition(recipe.id)
    } catch {
      recipeNutritionMap[recipe.id] = emptyRecipeNutrition()
    }
  }
}

onMounted(async () => {
  await Promise.all([refreshFoods(), refreshRecipes()])
  await refreshRecipeNutrition()
})
</script>

<style scoped>
.field-input {
  @apply min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950;
}
</style>
