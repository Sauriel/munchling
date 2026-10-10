import { createUuid } from './sync'
import type { ServerAggregate, ServerGuard, ServerOperation } from './server'
import { SyncClientError } from './replies'

export const mergeNutrients = ['calories_per_100g','fat_per_100g','carbs_per_100g','sugar_per_100g','protein_per_100g','fiber_per_100g','salt_per_100g'] as const
export type FoodMergeReference = { uuid: string; label: string; direct: boolean }
export type FoodMergeReview = {
  token: string
  source: Record<string, unknown>
  target: Record<string, unknown>
  ingredients: number
  recipes: FoodMergeReference[]
  meals: FoodMergeReference[]
}

// Input must be one validated complete server cut, never a search result or
// local numeric-ID list. No matching by EAN/name and no historical recalculation.
export function planFoodMerge(aggregates: ServerAggregate[], sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new SyncClientError('mergeSameFood')
  const roots = new Map(aggregates.map(root => [root.id,root]))
  function active(id: string) {
    const root = roots.get(id)
    if (!root?.data || root.deletedAt !== null || root.version < 1) throw new SyncClientError('reference')
    return root
  }
  const source = active(sourceId), target = active(targetId)
  if (source.entity !== 'foods' || target.entity !== 'foods') throw new SyncClientError('reference')
  for (const field of mergeNutrients) {
    const value = source.data![field], other = target.data![field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value !== other) throw new SyncClientError('mergeNutritionMismatch')
  }
  const recipes = aggregates.filter(root => root.entity === 'recipes' && root.data)
  const directRecipes = recipes.filter(root => (root.data!.ingredients as Record<string,unknown>[]).some(row => row.food_id === sourceId))
  const affected = new Set(directRecipes.map(root => root.id))
  const parents = new Map<string,string[]>()
  for (const recipe of recipes) for (const child of recipe.data!.ingredients as Record<string,unknown>[]) if (child.sub_recipe_id !== null) {
    const key = String(child.sub_recipe_id), list = parents.get(key) ?? []; list.push(recipe.id); parents.set(key,list)
  }
  const queue = [...affected]
  for (let index = 0; index < queue.length; index++) for (const parent of parents.get(queue[index]!) ?? []) if (!affected.has(parent)) { affected.add(parent); queue.push(parent) }
  const meals = aggregates.filter(root => root.entity === 'meal_logs' && root.data && (root.data.food_id === sourceId || affected.has(String(root.data.recipe_id))))
  const timestamp = new Date().toISOString()
  // Reaffirm the unchanged target as a versioned member of the same group.
  // Otherwise an offline client's dirty target could silently change historical
  // calculations when the redirected references arrive without a target change.
  const operations: ServerOperation[] = [{ operationId: createUuid(),entity: 'foods',entityUuid: targetId,baseRevision: target.version,operation: 'upsert',payload: structuredClone(target.data!) }]
  const upsert = (root: ServerAggregate, payload: Record<string,unknown>) => operations.push({ operationId: createUuid(),entity: root.entity,entityUuid: root.id,baseRevision: root.version,operation: 'upsert',payload: { ...payload,updated_at: timestamp } })
  for (const recipe of directRecipes) {
    const payload = structuredClone(recipe.data!)
    payload.ingredients = (payload.ingredients as Record<string,unknown>[]).map(row => row.food_id === sourceId ? { ...row,food_id: targetId } : row)
    upsert(recipe,payload)
  }
  for (const meal of meals) if (meal.data!.food_id === sourceId) upsert(meal,{ ...structuredClone(meal.data!),food_id: targetId })
  operations.push({ operationId: createUuid(),entity: 'foods',entityUuid: sourceId,baseRevision: source.version,operation: 'delete',payload: { id: sourceId,deleted_at: timestamp } })
  const changed = new Set(operations.map(op => op.entityUuid)), guards = new Map<string,ServerGuard>()
  function guard(id: unknown) {
    if (id === null || changed.has(String(id))) return
    const root = active(String(id)); guards.set(root.id,{ entity: root.entity,entityUuid: root.id,baseRevision: root.version })
  }
  guard(targetId)
  for (const root of recipes.filter(row => affected.has(row.id))) {
    guard(root.id)
    for (const child of root.data!.ingredients as Record<string,unknown>[]) { guard(child.food_id); guard(child.sub_recipe_id) }
  }
  for (const meal of meals) {
    guard(meal.id)
    for (const child of meal.data!.profiles as Record<string,unknown>[]) guard(child.profile_id)
  }
  const review: Omit<FoodMergeReview,'token'> = {
    source: structuredClone(source.data!),target: structuredClone(target.data!),
    ingredients: directRecipes.reduce((n,r) => n+(r.data!.ingredients as Record<string,unknown>[]).filter(row => row.food_id === sourceId).length,0),
    recipes: recipes.filter(root => affected.has(root.id)).map(root => ({ uuid: root.id,label: String(root.data!.name_de),direct: directRecipes.includes(root) })),
    meals: meals.map(root => ({ uuid: root.id,label: String(root.data!.logged_at),direct: root.data!.food_id === sourceId })),
  }
  return { review,operations,guards: [...guards.values()] }
}
