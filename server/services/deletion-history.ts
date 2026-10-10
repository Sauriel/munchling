import type { ServerSql } from '../database/connection'
import type { SyncAggregate } from '../../shared/domain/sync'
import { affectedRecipeIds, type RecipeEdge } from '../../shared/domain/deletion-review'

export async function recipeDeletionSet(sql: ServerSql,entity: SyncAggregate,id: string) {
  if (entity !== 'foods' && entity !== 'recipes') return new Set<string>()
  const edges = await sql.query<RecipeEdge>('SELECT i.recipe_id AS recipeId,i.food_id AS foodId,i.sub_recipe_id AS subRecipeId FROM recipe_ingredients i JOIN recipes r ON r.uuid=i.recipe_id WHERE i.deleted_at IS NULL AND r.deleted_at IS NULL')
  return affectedRecipeIds(edges,entity,id)
}

/** Caller owns the household write lock. Check BEFORE any batch mutation so a
 * request cannot hide booked history by deleting/rewiring it first. */
export async function hasDeletionHistory(sql: ServerSql, entity: SyncAggregate, id: string, recipeSet?: ReadonlySet<string>): Promise<boolean> {
  if (entity === 'activities') return false // Logs are independent dated snapshots.
  if (entity === 'meal_logs') return (await sql.query('SELECT uuid FROM meal_logs WHERE uuid=? AND deleted_at IS NULL LIMIT 1',[id])).length > 0
  if (entity === 'activity_logs') return (await sql.query('SELECT uuid FROM activity_logs WHERE uuid=? AND deleted_at IS NULL LIMIT 1',[id])).length > 0
  if (entity === 'profiles') {
    if ((await sql.query('SELECT p.uuid FROM meal_log_profiles p JOIN meal_logs m ON m.uuid=p.meal_log_id WHERE p.profile_id=? AND p.deleted_at IS NULL AND m.deleted_at IS NULL LIMIT 1',[id])).length) return true
    return (await sql.query('SELECT uuid FROM activity_logs WHERE profile_id=? AND deleted_at IS NULL LIMIT 1',[id])).length > 0
  }
  if (entity === 'foods' && (await sql.query('SELECT uuid FROM meal_logs WHERE food_id=? AND deleted_at IS NULL LIMIT 1',[id])).length) return true
  const affected = recipeSet ?? await recipeDeletionSet(sql,entity,id)
  if (!affected.size) return false
  // UUID-only distinct projection: constant query count, no recursive SQL depth
  // limit, interpolated identifiers or new MariaDB JSON_TABLE requirement.
  const booked = await sql.query<{ recipeId: string }>('SELECT DISTINCT recipe_id AS recipeId FROM meal_logs WHERE recipe_id IS NOT NULL AND deleted_at IS NULL')
  return booked.some(row => affected.has(row.recipeId))
}
