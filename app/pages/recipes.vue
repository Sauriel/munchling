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
        <div class="grid grid-cols-2 gap-3">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('recipes.fields.nameDe') }}</span>
            <input v-model="form.nameDe" required class="field-input" :placeholder="$t('recipes.placeholders.nameDe')">
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('recipes.fields.nameEn') }}</span>
            <input v-model="form.nameEn" required class="field-input" :placeholder="$t('recipes.placeholders.nameEn')">
          </label>
        </div>

        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('recipes.fields.description') }}</span>
          <textarea v-model="form.description" class="field-input min-h-24 py-3" :placeholder="$t('recipes.placeholders.description')" />
        </label>

        <label class="flex min-h-12 items-center gap-3 rounded-2xl bg-slate-50 px-4 dark:bg-slate-950">
          <input v-model="form.isSubRecipe" type="checkbox" class="size-5 rounded border-slate-300 text-munchling-600 focus:ring-munchling-600">
          <span class="text-sm font-medium">{{ $t('recipes.fields.isSubRecipe') }}</span>
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
            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-1.5">
                <span class="text-xs font-medium text-slate-500">{{ $t('recipes.ingredients.kind') }}</span>
                <select v-model="ingredient.kind" class="field-input" @change="ingredient.sourceId = null">
                  <option value="food">{{ $t('recipes.ingredients.food') }}</option>
                  <option value="recipe">{{ $t('recipes.ingredients.recipe') }}</option>
                </select>
              </label>
              <label class="block space-y-1.5">
                <span class="text-xs font-medium text-slate-500">{{ $t('recipes.ingredients.amount') }}</span>
                <input v-model.number="ingredient.amountGrams" required min="0.01" step="0.01" type="number" inputmode="decimal" class="field-input">
              </label>
            </div>

            <label class="block space-y-1.5">
              <span class="text-xs font-medium text-slate-500">{{ $t('recipes.ingredients.source') }}</span>
              <select v-model.number="ingredient.sourceId" required class="field-input">
                <option :value="null" disabled>{{ $t('recipes.ingredients.selectSource') }}</option>
                <option v-for="option in sourceOptions(ingredient.kind)" :key="option.id" :value="option.id">
                  {{ option.name }}
                </option>
              </select>
            </label>

            <button type="button" class="min-h-10 w-full rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeIngredientRow(index)">
              {{ $t('recipes.ingredients.remove') }}
            </button>
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
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-semibold">{{ recipe.nameDe }}</h3>
              <span v-if="recipe.isSubRecipe" class="rounded-full bg-munchling-50 px-2 py-0.5 text-xs font-semibold text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500">{{ $t('recipes.subRecipe') }}</span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ recipe.nameEn }}</p>
            <p v-if="recipe.description" class="mt-1 text-xs text-slate-400">{{ recipe.description }}</p>
          </div>
          <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right dark:bg-slate-950">
            <p class="text-lg font-bold">{{ recipeNutritionMap[recipe.id]?.per100g.calories ?? 0 }}</p>
            <p class="text-xs text-slate-500">kcal/100g</p>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div v-for="item in nutritionSummary(recipeNutritionMap[recipe.id]?.per100g)" :key="item.label" class="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <dt class="text-slate-500 dark:text-slate-400">{{ $t(item.label) }}</dt>
            <dd class="mt-1 font-semibold">{{ item.value }}</dd>
          </div>
        </dl>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button type="button" class="min-h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" @click="editRecipe(recipe)">
            {{ $t('common.edit') }}
          </button>
          <button type="button" class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300" @click="removeRecipe(recipe)">
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
import { useRecipes } from '~/composables/useRecipes'
import type { Food, NutritionValues, Recipe, RecipeIngredientInput, RecipeNutrition } from '~/utils/database/repositories'

type IngredientRow = {
  clientId: string
  kind: 'food' | 'recipe'
  sourceId: number | null
  amountGrams: number
}

type RecipeForm = {
  nameDe: string
  nameEn: string
  description: string
  isSubRecipe: boolean
  ingredients: IngredientRow[]
}

const { t } = useI18n()
const { foods, refreshFoods } = useFoods()
const { recipes, isLoading, refreshRecipes, loadRecipe, createRecipe, updateRecipe, deleteRecipe, calculateRecipeNutrition } = useRecipes()

const isSaving = ref(false)
const editingRecipeId = ref<number | null>(null)
const isEditing = computed(() => editingRecipeId.value !== null)
const recipeNutritionMap = reactive<Record<number, RecipeNutrition>>({})

const emptyNutrition = (): NutritionValues => ({ calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0 })
const emptyRecipeNutrition = (): RecipeNutrition => ({ totalWeightGrams: 0, total: emptyNutrition(), per100g: emptyNutrition() })

const emptyForm = (): RecipeForm => ({ nameDe: '', nameEn: '', description: '', isSubRecipe: false, ingredients: [] })
const form = reactive<RecipeForm>(emptyForm())

function nextClientId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function sourceOptions(kind: IngredientRow['kind']) {
  if (kind === 'food') {
    return foods.value.map((food) => ({ id: food.id, name: `${food.nameDe}${food.brand ? ` · ${food.brand}` : ''}` }))
  }

  return recipes.value
    .filter((recipe) => recipe.id !== editingRecipeId.value)
    .map((recipe) => ({ id: recipe.id, name: recipe.nameDe }))
}

function addIngredientRow() {
  form.ingredients.push({ clientId: nextClientId(), kind: 'food', sourceId: null, amountGrams: 100 })
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
    nameDe: recipeWithIngredients.nameDe,
    nameEn: recipeWithIngredients.nameEn,
    description: recipeWithIngredients.description ?? '',
    isSubRecipe: recipeWithIngredients.isSubRecipe,
    ingredients: recipeWithIngredients.ingredients.map((ingredient) => ({
      clientId: nextClientId(),
      kind: ingredient.foodId ? 'food' : 'recipe',
      sourceId: ingredient.foodId ?? ingredient.subRecipeId,
      amountGrams: ingredient.amountGrams
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
      nameDe: form.nameDe,
      nameEn: form.nameEn,
      description: optionalText(form.description),
      isSubRecipe: form.isSubRecipe,
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
