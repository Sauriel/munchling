import { describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { snapshot,page,binding,url } from '../helpers/sync-wire'
import { createTestDatabase } from '../helpers/sqlite'
import { createSnapshotStaging } from '../../app/utils/sync/staging'
import { createRemoteReceiver } from '../../app/utils/sync/apply'
import { createSyncQueue } from '../../app/utils/database/outbox'
import { planFoodMerge } from '../../shared/domain/food-merge'

async function setup() {
  const db = await createTestDatabase(), f = mergeFixture(), stage = createSnapshotStaging(db.database), localEpoch = (await stage.state()).localEpoch, receiver = createRemoteReceiver(db.database)
  await stage.begin(localEpoch,url,snapshot(f.roots)); expect((await receiver.adoptSnapshot(localEpoch)).status).toBe('applied')
  const plan = planFoodMerge(f.roots,f.source.id,f.target.id)
  const changes = plan.operations.map(op => ({ entity: op.entity,id: op.entityUuid,version: 2,deletedAt: op.operation === 'delete' ? String(op.payload.deleted_at) : null,data: op.operation === 'delete' ? null : op.payload }))
  return { db,f,receiver,changes,context: { ...binding,localEpoch,url,cursor: '0' } }
}
describe('registered merge received by offline SQLite clients', () => {
  it('preserves historical calculations, stable children IDs/UUIDs, portions and target ID with no echo', async () => {
    const { db,f,receiver,changes,context } = await setup()
    try {
      const before = await db.service.mealLogs.listMealLogs(), children = await db.database.query('SELECT id,uuid,amount_grams FROM recipe_ingredients ORDER BY id;'), portions = await db.database.query('SELECT * FROM meal_log_profiles ORDER BY id;')
      const target = (await db.database.query<{ id: number }>('SELECT id FROM foods WHERE uuid=?;',[f.target.id]))[0]!.id
      expect((await receiver.applyPage(context,page(changes)))[0]!.status).toBe('applied')
      expect(await db.database.query('SELECT id,uuid,amount_grams FROM recipe_ingredients ORDER BY id;')).toEqual(children)
      expect(await db.database.query('SELECT * FROM meal_log_profiles ORDER BY id;')).toEqual(portions)
      for (const meal of await db.service.mealLogs.listMealLogs()) { const old = before.find(row => row.id === meal.id)!; expect(meal.nutritionPer100g).toEqual(old.nutritionPer100g); expect(meal.loggedAt).toBe(old.loggedAt); expect(meal.totalWeightGrams).toBe(old.totalWeightGrams) }
      expect((await db.database.query('SELECT food_id FROM meal_logs WHERE uuid=?;',[f.direct.id]))[0]).toEqual({ food_id: target })
      expect(await createSyncQueue(db.database).list()).toEqual([])
    } finally { db.close() }
  })
  it.each(['recipe','target'])('blocks the whole merge with an in-flight local %s edit and preserves its exact queue and source', async kind => {
    const { db,f,receiver,changes,context } = await setup()
    try {
      if (kind === 'recipe') {
        const r = (await db.database.query<{ id: number }>('SELECT id FROM recipes WHERE uuid=?;',[f.r.id]))[0]!
        await db.service.recipes.updateRecipe(r.id,{ nameDe: 'Local draft' })
      } else {
        const target = (await db.database.query<{ id: number }>('SELECT id FROM foods WHERE uuid=?;',[f.target.id]))[0]!
        await db.service.foods.updateFood(target.id,{ caloriesPer100g: 201 })
      }
      const queue = createSyncQueue(db.database), claimed = await queue.claimNextBatch(), before = await queue.list()
      expect((await receiver.applyPage(context,page(changes)))[0]!.status).toBe('blocked')
      expect(await queue.list()).toEqual(before); expect(await queue.claimNextBatch()).toEqual(claimed)
      expect(await db.database.query('SELECT uuid FROM foods WHERE uuid=?;',[f.source.id])).toEqual([{ uuid: f.source.id }])
    } finally { db.close() }
  })
})
