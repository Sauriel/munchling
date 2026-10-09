import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { describe, it, expect, vi } from 'vitest'
import { mealSourceMatches } from '../../app/utils/meal-source-search'
import * as Portions from '../../shared/domain/portions'

function mountPicker() {
  const food = { id: 7, nameDe: 'Apfel', nameEn: 'Apple', portionSizeGrams: 125 as number | null }
  const recipe = { id: 7, nameDe: 'Apfelgericht', nameEn: 'Apple recipe', portionSizeGrams: 300 }
  const catalog = { id: 7, nameDe: 'Apfel BLS', nameEn: '', caloriesPer100g: 52, fatPer100g: 0, carbsPer100g: 12, sugarPer100g: 10, fiberPer100g: 2, proteinPer100g: 1, saltPer100g: 0 }
  const foods = Vue.ref([food]), recipes = Vue.ref([recipe]), searchError = Vue.ref(null)
  const createFood = vi.fn(async (_input: unknown) => ({ ...catalog, id: 99 }))
  const refreshFoods = vi.fn(async () => { if (createFood.mock.calls.length) foods.value.push({ ...catalog, id: 99, portionSizeGrams: null }) })
  const search = vi.fn(async (_query: string) => [catalog])
  const refreshMealLogs = vi.fn(async () => {})
  const imports: Record<string, unknown> = {
    vue: Vue,
    '../../shared/domain/portions': Portions,
    '~/composables/useFoods': { useFoods: () => ({ foods, refreshFoods, createFood }) },
    '~/composables/useRecipes': { useRecipes: () => ({ recipes, refreshRecipes: async () => {}, calculateRecipeNutrition: async () => ({ per100g: {} }) }) },
    '~/composables/useProfiles': { useProfiles: () => ({ profiles: Vue.ref([{ id: 1, name: 'P' }]), refreshProfiles: async () => {} }) },
    '~/composables/useMealLogs': { useMealLogs: () => ({ mealLogs: Vue.ref([]), refreshMealLogs, isLoading: Vue.ref(false) }) },
    '~/composables/useBundledFoodSearch': { useBundledFoodSearch: () => ({ searchBundledFoods: search, bundledFoodSearchError: searchError }) },
    '~/utils/meal-source-search': { mealSourceMatches },
    '../../shared/domain/validation': { validationMessage: () => 'import failed' }
  }
  const descriptor = parse(readFileSync(new URL('../../app/pages/log.vue', import.meta.url), 'utf8')).descriptor
  const source = compileScript(descriptor, { id: 'meal-picker-test', genDefaultAs: 'Picker' }).content
  const js = transpileModule(source + '\nexports.Picker = Picker;', { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  new Script(js).runInNewContext({ exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`); return imports[name] }, ...Vue, useRoute: () => ({ query: {} }), useI18n: () => ({ t: (key: string) => key }), setTimeout, clearTimeout })
  exports.Picker.render = () => null
  const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, insert: () => {}, remove: () => {}, patchProp: () => {} })
  const app = renderer.createApp(exports.Picker); app.mount({})
  return { app, state: app._instance!.setupState, createFood, search, refreshFoods, refreshMealLogs, food, recipe, catalog }
}

describe('actual meal picker setup', () => {
  it('keeps recipe and food IDs separate, imports catalog IDs as household foods, and resets selection', async () => {
    const p = mountPicker()
    try {
      await vi.waitFor(() => expect(p.refreshMealLogs).toHaveBeenCalledOnce())
      expect(p.refreshFoods).toHaveBeenCalledWith('')
      expect(p.state.sourceGroups.map((g: any) => g.type)).toEqual(['recipe', 'food'])
      await p.state.selectSource('recipe', p.recipe); expect(p.state.form.sourceType).toBe('recipe'); expect(p.state.form.sourceId).toBe(7)
      await p.state.selectSource('bundled', p.catalog)
      expect(p.createFood).toHaveBeenCalledWith(expect.objectContaining({ nameEn: p.catalog.nameDe, caloriesPer100g: 52, isCustom: false }))
      expect(p.createFood.mock.calls[0]?.[0]).not.toHaveProperty('id')
      expect(p.state.form.sourceType).toBe('food'); expect(p.state.form.sourceId).toBe(99)
      p.state.resetForm(); expect(p.state.form.sourceId).toBeNull(); expect(p.state.sourceQuery).toBe('')
    } finally { p.app.unmount() }
  })
  it('uses portion counts but retains canonical grams across units and sources', async () => {
    const p = mountPicker()
    try {
      await vi.waitFor(() => expect(p.refreshMealLogs).toHaveBeenCalledOnce())
      await p.state.selectSource('food', p.food)
      p.state.quantityUnit = 'portions'; p.state.setProfileQuantity(1, '0.5')
      expect(p.state.mealLogInput().profiles[0].portionGrams).toBe(62.5)
      p.state.quantityUnit = 'grams'; expect(p.state.profilePortions[1]).toBe(62.5)
      p.state.quantityUnit = 'portions'; await p.state.selectSource('recipe', p.recipe)
      expect(p.state.profilePortions[1]).toBe(62.5)
      p.state.setProfileQuantity(1, '1.5'); expect(p.state.totalWeightGrams).toBe(450)
      p.state.form.sourceId = null; expect(p.state.quantityUnit).toBe('grams')
    } finally { p.app.unmount() }
  })
  it('ignores stale database replies when the query changes', async () => {
    const p = mountPicker()
    try {
      await vi.waitFor(() => expect(p.refreshMealLogs).toHaveBeenCalledOnce())
      let resolve!: (result: typeof p.catalog[]) => void
      p.search.mockImplementationOnce(() => new Promise(r => { resolve = r }))
      p.state.sourceQuery = 'apple'; await Vue.nextTick()
      await vi.waitFor(() => expect(p.search).toHaveBeenCalledOnce())
      p.state.sourceQuery = ''; await Vue.nextTick(); resolve([p.catalog]); await Promise.resolve(); await Vue.nextTick()
      expect(p.state.bundledResults).toEqual([]); expect(p.state.searching).toBe(false)
    } finally { p.app.unmount() }
  })
})
