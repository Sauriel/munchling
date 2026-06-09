<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('foods.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('foods.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('foods.description') }}
        </p>
      </div>

      <NuxtLink to="/recipes" class="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <Icon name="ph:cooking-pot-duotone" class="size-5" />
        {{ $t('recipes.title') }}
      </NuxtLink>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ isEditing ? $t('foods.form.editTitle') : $t('foods.form.createTitle') }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('foods.form.hint') }}
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

      <div class="mb-4 space-y-3">
        <button
          type="button"
          class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-munchling-600/30 bg-munchling-50 px-4 font-semibold text-munchling-700 transition active:scale-[0.98] disabled:opacity-60 dark:bg-munchling-600/15 dark:text-munchling-500"
          :disabled="isScanning"
          @click="scanBarcode"
        >
          <Icon name="ph:barcode-duotone" class="size-5" />
          {{ isScanning ? $t('foods.scanner.scanning') : $t('foods.scanner.button') }}
        </button>
        <p v-if="scanNotice" class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          {{ scanNotice }}
        </p>
        <p v-if="scanError" class="rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {{ scanError }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="submitForm">
        <div class="grid grid-cols-2 gap-3">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('foods.fields.nameDe') }}</span>
            <input v-model="form.nameDe" required class="field-input" :placeholder="$t('foods.placeholders.nameDe')">
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('foods.fields.nameEn') }}</span>
            <input v-model="form.nameEn" required class="field-input" :placeholder="$t('foods.placeholders.nameEn')">
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('foods.fields.brand') }}</span>
            <input v-model="form.brand" class="field-input" :placeholder="$t('foods.placeholders.brand')">
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t('foods.fields.ean') }}</span>
            <input v-model="form.ean" inputmode="numeric" class="field-input" :placeholder="$t('foods.placeholders.ean')">
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label v-for="field in nutrientFields" :key="field.key" class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t(field.label) }}</span>
            <input
              v-model.number="form[field.key]"
              required
              min="0"
              step="0.01"
              inputmode="decimal"
              type="number"
              class="field-input"
            >
          </label>
        </div>

        <button
          type="submit"
          class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-4 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98] disabled:opacity-60"
          :disabled="isSaving"
        >
          <Icon :name="isEditing ? 'ph:check-circle-duotone' : 'ph:plus-circle-duotone'" class="size-5" />
          {{ isEditing ? $t('foods.actions.save') : $t('foods.actions.create') }}
        </button>
      </form>
    </section>

    <section class="space-y-3">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            {{ $t('foods.listTitle') }}
          </h2>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {{ foods.length }}
          </span>
        </div>

        <label class="block space-y-1.5">
          <span class="sr-only">{{ $t('foods.search') }}</span>
          <div class="relative">
            <Icon name="ph:magnifying-glass" class="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <input
              v-model="searchModel"
              class="min-h-12 w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-900"
              :placeholder="$t('foods.searchPlaceholder')"
              @input="refreshFoods(searchModel)"
            >
          </div>
        </label>
      </div>

      <div v-if="isLoading" class="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="foods.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        {{ $t('foods.empty') }}
      </div>

      <article
        v-for="food in foods"
        v-else
        :key="food.id"
        class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-semibold">{{ food.nameDe }}</h3>
              <span v-if="food.isCustom" class="rounded-full bg-munchling-50 px-2 py-0.5 text-xs font-semibold text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500">
                {{ $t('foods.custom') }}
              </span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400">
              {{ food.nameEn }}<template v-if="food.brand"> · {{ food.brand }}</template>
            </p>
            <p v-if="food.ean" class="mt-1 text-xs text-slate-400">
              EAN {{ food.ean }}
            </p>
          </div>
          <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right dark:bg-slate-950">
            <p class="text-lg font-bold">{{ food.caloriesPer100g }}</p>
            <p class="text-xs text-slate-500">kcal/100g</p>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div v-for="nutrient in nutrientSummary(food)" :key="nutrient.label" class="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <dt class="text-slate-500 dark:text-slate-400">{{ $t(nutrient.label) }}</dt>
            <dd class="mt-1 font-semibold">{{ nutrient.value }}</dd>
          </div>
        </dl>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="min-h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            @click="editFood(food)"
          >
            {{ $t('common.edit') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"
            @click="removeFood(food)"
          >
            {{ $t('common.delete') }}
          </button>
        </div>
      </article>
    </section>
    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useBarcodeScanner } from '~/composables/useBarcodeScanner'
import { useFoods } from '~/composables/useFoods'
import type { Food } from '~/utils/database/repositories'

type FoodForm = {
  nameDe: string
  nameEn: string
  brand: string
  ean: string
  caloriesPer100g: number
  fatPer100g: number
  carbsPer100g: number
  sugarPer100g: number
  fiberPer100g: number
  proteinPer100g: number
  saltPer100g: number
}

type NutrientKey = Exclude<keyof FoodForm, 'nameDe' | 'nameEn' | 'brand' | 'ean'>

const { t } = useI18n()
const { foods, searchTerm, isLoading, refreshFoods, createFood, updateFood, deleteFood, getFoodByEan } = useFoods()
const { isScanning, scanError, scanEan } = useBarcodeScanner()

const isSaving = ref(false)
const editingFoodId = ref<number | null>(null)
const isEditing = computed(() => editingFoodId.value !== null)
const searchModel = ref(searchTerm.value)
const scanNotice = ref<string | null>(null)

const emptyForm = (): FoodForm => ({
  nameDe: '',
  nameEn: '',
  brand: '',
  ean: '',
  caloriesPer100g: 0,
  fatPer100g: 0,
  carbsPer100g: 0,
  sugarPer100g: 0,
  fiberPer100g: 0,
  proteinPer100g: 0,
  saltPer100g: 0
})

const form = reactive<FoodForm>(emptyForm())

const nutrientFields: Array<{ key: NutrientKey; label: string }> = [
  { key: 'caloriesPer100g', label: 'foods.fields.calories' },
  { key: 'fatPer100g', label: 'foods.fields.fat' },
  { key: 'carbsPer100g', label: 'foods.fields.carbs' },
  { key: 'sugarPer100g', label: 'foods.fields.sugar' },
  { key: 'fiberPer100g', label: 'foods.fields.fiber' },
  { key: 'proteinPer100g', label: 'foods.fields.protein' },
  { key: 'saltPer100g', label: 'foods.fields.salt' }
]

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function resetForm() {
  Object.assign(form, emptyForm())
  editingFoodId.value = null
}

function editFood(food: Food) {
  editingFoodId.value = food.id
  Object.assign(form, {
    nameDe: food.nameDe,
    nameEn: food.nameEn,
    brand: food.brand ?? '',
    ean: food.ean ?? '',
    caloriesPer100g: food.caloriesPer100g,
    fatPer100g: food.fatPer100g,
    carbsPer100g: food.carbsPer100g,
    sugarPer100g: food.sugarPer100g,
    fiberPer100g: food.fiberPer100g,
    proteinPer100g: food.proteinPer100g,
    saltPer100g: food.saltPer100g
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function submitForm() {
  isSaving.value = true

  try {
    const input = {
      nameDe: form.nameDe,
      nameEn: form.nameEn,
      brand: optionalText(form.brand),
      ean: optionalText(form.ean),
      caloriesPer100g: form.caloriesPer100g,
      fatPer100g: form.fatPer100g,
      carbsPer100g: form.carbsPer100g,
      sugarPer100g: form.sugarPer100g,
      fiberPer100g: form.fiberPer100g,
      proteinPer100g: form.proteinPer100g,
      saltPer100g: form.saltPer100g,
      isCustom: true
    }

    if (editingFoodId.value) {
      await updateFood(editingFoodId.value, input)
    } else {
      await createFood(input)
    }

    resetForm()
  } finally {
    isSaving.value = false
  }
}

async function removeFood(food: Food) {
  if (!confirm(t('foods.confirmDelete', { name: food.nameDe }))) {
    return
  }

  await deleteFood(food.id)
}

async function scanBarcode() {
  scanNotice.value = null
  const scannedEan = await scanEan(t('foods.scanner.instructions'))

  if (!scannedEan) {
    return
  }

  const existingFood = await getFoodByEan(scannedEan)

  if (existingFood) {
    editFood(existingFood)
    scanNotice.value = t('foods.scanner.found', { ean: scannedEan, name: existingFood.nameDe })
    return
  }

  resetForm()
  form.ean = scannedEan
  scanNotice.value = t('foods.scanner.notFound', { ean: scannedEan })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function formatGram(value: number) {
  return `${value}g`
}

function nutrientSummary(food: Food) {
  return [
    { label: 'foods.fields.protein', value: formatGram(food.proteinPer100g) },
    { label: 'foods.fields.carbs', value: formatGram(food.carbsPer100g) },
    { label: 'foods.fields.fat', value: formatGram(food.fatPer100g) },
    { label: 'foods.fields.sugar', value: formatGram(food.sugarPer100g) },
    { label: 'foods.fields.fiber', value: formatGram(food.fiberPer100g) },
    { label: 'foods.fields.salt', value: formatGram(food.saltPer100g) }
  ]
}

onMounted(async () => {
  await refreshFoods(searchModel.value)
})
</script>

<style scoped>
.field-input {
  @apply min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950;
}
</style>
