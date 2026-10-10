<template>
  <details v-if="capability" class="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" @toggle="opened">
    <summary class="min-h-11 cursor-pointer font-semibold">{{ $t('foods.merge.title') }}</summary>
    <div class="mt-3 space-y-3">
      <p class="text-sm">{{ $t('foods.merge.scope') }}</p>
      <label class="block space-y-1"><span>{{ $t('foods.merge.source') }}</span><select v-model="source" class="field-input" :disabled="busy" @change="invalidate"><option value="">—</option><option v-for="food in choices" :key="food.id" :value="String(food.id)">{{ food.nameDe }} · {{ food.brand || '—' }} · {{ food.ean || '—' }} · #{{ food.id }}</option></select></label>
      <label class="block space-y-1"><span>{{ $t('foods.merge.target') }}</span><select v-model="target" class="field-input" :disabled="busy" @change="invalidate"><option value="">—</option><option v-for="food in choices" :key="food.id" :value="String(food.id)">{{ food.nameDe }} · {{ food.brand || '—' }} · {{ food.ean || '—' }} · #{{ food.id }}</option></select></label>
      <button type="button" class="min-h-11 rounded-xl border px-4 disabled:opacity-50" :disabled="busy || !source || !target || source === target" @click="preview">{{ $t('foods.merge.preview') }}</button>
      <div v-if="review" class="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
        <div v-for="(row, index) in [review.source, review.target]" :key="index" class="break-words text-sm">
          <h3 class="font-semibold">{{ $t(index === 0 ? 'foods.merge.source' : 'foods.merge.target') }}</h3>
          <p>UUID: {{ row.id }}</p>
          <p>{{ row.name_de }} / {{ row.name_en }} · {{ row.brand || '—' }} · {{ row.ean || '—' }}</p>
          <p>{{ $t('foods.merge.portion') }}: {{ row.portion_size_grams ?? '—' }} g</p>
          <dl class="grid grid-cols-2 gap-x-3"><template v-for="field in mergeNutrients" :key="field"><dt>{{ $t(`foods.merge.nutrients.${field}`) }}</dt><dd>{{ row[field] }}</dd></template></dl>
        </div>
        <p class="text-sm">{{ $t('foods.merge.references', { ingredients: review.ingredients, recipes: review.recipes.length, meals: review.meals.length }) }}</p>
        <ul class="max-h-48 overflow-auto text-sm"><li v-for="row in [...review.recipes, ...review.meals]" :key="row.uuid" class="break-words">{{ row.label }} · {{ row.uuid }} — {{ $t(row.direct ? 'foods.merge.direct' : 'foods.merge.indirect') }}</li></ul>
        <p class="text-sm font-semibold">{{ $t('foods.merge.warning') }}</p>
        <label class="flex min-h-11 items-center gap-3 text-sm"><input v-model="confirmed" type="checkbox" class="size-5" :disabled="busy">{{ $t('foods.merge.confirm') }}</label>
        <button type="button" class="min-h-11 rounded-xl bg-munchling-600 px-4 font-semibold text-white disabled:opacity-50" :disabled="busy || !confirmed" @click="commit">{{ $t('foods.merge.commit') }}</button>
      </div>
      <p v-if="message" role="status" class="break-words text-sm">{{ message }}</p>
    </div>
  </details>
</template>
<script setup lang="ts">
import type { Food } from '../../shared/domain/types'
import { mergeNutrients, type FoodMergeReview } from '../../shared/domain/food-merge'
import { SyncClientError } from '../../shared/domain/replies'
const service = useMunchlingData(), capability = service.foodMerges, { t, te } = useI18n()
const choices = ref<Food[]>([]), source = ref(''), target = ref(''), busy = ref(false), confirmed = ref(false), review = shallowRef<FoodMergeReview | null>(null), message = ref('')
const { refreshFoods } = useFoods(), { refreshRecipes } = useRecipes(), { refreshMealLogs } = useMealLogs()
function invalidate() { review.value = null; confirmed.value = false; message.value = '' }
async function action(run: () => Promise<void>) {
  if (busy.value || !capability) return
  busy.value = true; message.value = ''
  try { await run() } catch (cause) {
    invalidate()
    const code = cause instanceof SyncClientError ? cause.code : 'localOrNetworkError'
    message.value = te(`foods.merge.errors.${code}`) ? t(`foods.merge.errors.${code}`) : t('foods.merge.failed', { code })
  } finally { busy.value = false }
}
async function opened(event: Event) { if ((event.target as HTMLDetailsElement).open) await action(async () => { invalidate(); choices.value = await service.foods.listFoods() }) }
async function preview() { await action(async () => { invalidate(); review.value = await capability!.preview(Number(source.value),Number(target.value)) }) }
async function commit() {
  const shown = review.value
  if (!shown || !confirmed.value) return
  await action(async () => {
    await capability!.commit(shown.token,true)
    invalidate(); source.value = ''; target.value = ''
    await Promise.all([refreshFoods(),refreshRecipes(),refreshMealLogs()]); choices.value = await service.foods.listFoods()
    message.value = t('foods.merge.done')
  })
}
</script>
