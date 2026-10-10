import { food, profile, recipe, date } from './sync-wire'
import { createUuid } from '../../shared/domain/sync'
import type { ServerAggregate } from '../../shared/domain/server'
export function mergeFixture() {
  const source = food('source-ean'), target = food('target-ean'), p = profile(), r = recipe(source.id), parent = recipe(target.id)
  source.data!.name_de = 'Source'; target.data!.name_de = 'Target'; source.data!.portion_size_grams = 25; target.data!.portion_size_grams = 50
  const child = (parent.data!.ingredients as Record<string, unknown>[])[0]!; child.food_id = null; child.sub_recipe_id = r.id
  const meal = (foodId: string | null, recipeId: string | null): ServerAggregate => {
    const id = createUuid()
    return { entity: 'meal_logs',id,version: 1,deletedAt: null,data: { id,food_id: foodId,recipe_id: recipeId,logged_at: '2020-01-02T12:34:56+02:00',total_weight_grams: 33.125,created_at: date,updated_at: null,profiles: [{ id: createUuid(),meal_log_id: id,profile_id: p.id,portion_factor: 0.625123456789,created_at: date }] } }
  }
  const direct = meal(source.id,null), indirect = meal(null,parent.id)
  return { source,target,p,r,parent,direct,indirect,roots: [source,target,p,r,parent,direct,indirect] }
}
