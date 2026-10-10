import type { ServerAggregate, ServerGuard } from './server'
import type { SyncAggregate } from './sync'

export type RecipeEdge = { recipeId: string; foodId: string | null; subRecipeId: string | null }
export function affectedRecipeIds(edges: readonly RecipeEdge[], entity: SyncAggregate, id: string) {
  const affected = new Set<string>(), parents = new Map<string,string[]>()
  if (entity === 'recipes') affected.add(id)
  for (const edge of edges) {
    if (entity === 'foods' && edge.foodId === id || entity === 'recipes' && edge.subRecipeId === id) affected.add(edge.recipeId)
    if (edge.subRecipeId !== null) { const list = parents.get(edge.subRecipeId) ?? []; list.push(edge.recipeId); parents.set(edge.subRecipeId,list) }
  }
  const queue = [...affected]
  for (let i = 0; i < queue.length; i++) for (const parent of parents.get(queue[i]!) ?? []) {
    if (!affected.has(parent)) { affected.add(parent); queue.push(parent) }
  }
  return affected
}

/** A complete validated cut, not a mixture of independently fetched roots. */
export function deletionReview(roots: readonly ServerAggregate[], entity: SyncAggregate, id: string) {
  const active = roots.filter(root => root.deletedAt === null && root.data !== null)
  const root = active.find(row => row.entity === entity && row.id === id)
  if (!root) throw new Error('reference')
  const recipes = active.filter(row => row.entity === 'recipes')
  const directRecipes = recipes.filter(row => (row.data!.ingredients as Record<string, unknown>[]).some(child =>
    entity === 'foods' ? child.food_id === id : entity === 'recipes' && child.sub_recipe_id === id))
  // Removing a nested ingredient changes every containing recipe's nutrition,
  // even when the writer physically changes only the immediate parents.
  const affectedRecipes = affectedRecipeIds(recipes.flatMap(row => (row.data!.ingredients as Record<string, unknown>[]).map(child => ({
    recipeId: row.id,foodId: child.food_id as string | null,subRecipeId: child.sub_recipe_id as string | null,
  }))),entity,id)
  const history = active.filter(row => {
    if (entity === 'profiles') return row.entity === 'activity_logs' && row.data!.profile_id === id ||
      row.entity === 'meal_logs' && (row.data!.profiles as Record<string, unknown>[]).some(portion => portion.profile_id === id)
    if (row.entity !== 'meal_logs') return false
    return entity === 'foods' && row.data!.food_id === id || affectedRecipes.has(String(row.data!.recipe_id))
  })
  const directMeals = active.filter(row => row.entity === 'meal_logs' && (
    entity === 'foods' && row.data!.food_id === id || entity === 'recipes' && row.data!.recipe_id === id))
  const dependents = entity === 'profiles' ? history : [...directRecipes,...directMeals]
  const indirect = recipes.filter(row => row.id !== id && affectedRecipes.has(row.id) && !directRecipes.includes(row))
  const guards: ServerGuard[] = [...new Map([...dependents,...indirect,...history].filter(row => row.id !== id)
    .map(row => [row.id,{ entity: row.entity,entityUuid: row.id,baseRevision: row.version }])).values()]
  return { root: structuredClone(root),dependents: structuredClone(dependents),indirect: structuredClone(indirect),history: structuredClone(history),guards }
}
