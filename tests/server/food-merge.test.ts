import { afterAll,beforeAll,beforeEach,describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { newDatabase,resetDatabase } from './helpers'
import type { ServerDatabase } from '../../server/database/connection'
import { readServerState } from '../../server/database/state'
import { readWebState } from '../../server/services/web'
import { readServerAggregate } from '../../server/services/storage'
import { writeServerBatch } from '../../server/services/write'
import { createUuid } from '../../shared/domain/sync'
import { planFoodMerge } from '../../shared/domain/food-merge'
import type { ServerWriteBatch,ServerOperation } from '../../shared/domain/server'
import { createWebView } from '../../app/utils/data/web-view'

describe('real MariaDB registered-food merge', () => {
  let db: ServerDatabase
  beforeAll(() => { db = newDatabase() }); beforeEach(async () => { await resetDatabase(db) }); afterAll(async () => { await db.close() })
  async function request(operations: ServerOperation[],guards: ServerWriteBatch['guards'] = []) {
    const state = await db.withConnection(readServerState)
    return { batchId: createUuid(),serverInstanceId: state.instance_uuid,serverEpoch: state.epoch_uuid,operations,guards }
  }
  async function setup() {
    const f = mergeFixture()
    await writeServerBatch(db,await request(f.roots.map(root => ({ operationId: createUuid(),entity: root.entity,entityUuid: root.id,baseRevision: 0,operation: 'upsert',payload: root.data! }))))
    const state = await db.withConnection(readServerState), binding = { serverInstanceId: state.instance_uuid,serverEpoch: state.epoch_uuid }
    const view = await readWebState(db,binding), plan = planFoodMerge(view.snapshot.aggregates,f.source.id,f.target.id)
    return { f,binding,view,plan,batch: await request(plan.operations,plan.guards) }
  }
  it('rewires without cascades, preserves child UUID/view IDs, grams/factors/literal dates/nutrition and replays exactly', async () => {
    const { f,binding,view,batch } = await setup(), before = createWebView(view), beforeMeals = await before.read.mealLogs.listMealLogs()
    const receipt = await writeServerBatch(db,batch); expect(await writeServerBatch(db,structuredClone(batch))).toEqual(receipt)
    const afterState = await readWebState(db,binding), after = createWebView(afterState)
    expect((await readServerAggregate(db,'foods',f.source.id))!.data).toBeNull()
    expect((await readServerAggregate(db,'foods',f.target.id))!.version).toBe(2); expect((await readServerAggregate(db,'foods',f.target.id))!.data).toEqual(view.snapshot.aggregates.find(row => row.id === f.target.id)!.data)
    const recipes = await after.read.recipes.listRecipes(); expect(recipes).toHaveLength(2)
    expect((await after.read.recipes.listRecipeIngredients(after.id(f.r.id)))[0]).toMatchObject({ id: before.id(String((f.r.data!.ingredients as Record<string,unknown>[])[0]!.id)),foodId: before.id(f.target.id),amountGrams: 100 })
    const meals = await after.read.mealLogs.listMealLogs(); expect(meals).toHaveLength(2)
    for (const meal of meals) { const old = beforeMeals.find(row => row.id === meal.id)!; expect(meal.loggedAt).toBe(old.loggedAt); expect(meal.totalWeightGrams).toBe(old.totalWeightGrams); expect(meal.profiles).toEqual(old.profiles); expect(meal.nutritionPer100g).toEqual(old.nutritionPer100g) }
    expect(afterState.viewIds).toEqual(view.viewIds)
    expect((await readServerAggregate(db,'recipes',f.parent.id))!.version).toBe(1)
  })
  it.each(['source','target','recipe','meal'])('rejects an intervening %s edit without deleting or rebasing anything', async kind => {
    const { f,batch } = await setup(), root = kind === 'source' ? f.source : kind === 'target' ? f.target : kind === 'recipe' ? f.r : f.direct
    const data = { ...(await readServerAggregate(db,root.entity,root.id))!.data! }
    if (root.entity === 'foods') data.calories_per_100g = 101
    else if (root.entity === 'recipes') data.name_de = 'Concurrent'
    else data.logged_at = '2021-02-03T12:34'
    await writeServerBatch(db,await request([{ operationId: createUuid(),entity: root.entity,entityUuid: root.id,baseRevision: 1,operation: 'upsert',payload: data }]))
    const snapshot = await readServerAggregate(db,root.entity,root.id)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'versionConflict' })
    expect(await readServerAggregate(db,root.entity,root.id)).toEqual(snapshot); expect((await readServerAggregate(db,'foods',f.source.id))!.data).not.toBeNull()
  })
  it('rejects a newly added direct reference rather than cascading an unseen meal', async () => {
    const { f,batch } = await setup(), id = createUuid(), meal = structuredClone(f.direct.data!)
    meal.id = id; meal.profiles = (meal.profiles as Record<string,unknown>[]).map(row => ({ ...row,id: createUuid(),meal_log_id: id }))
    await writeServerBatch(db,await request([{ operationId: createUuid(),entity: 'meal_logs',entityUuid: id,baseRevision: 0,operation: 'upsert',payload: meal }]))
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'dependencyConflict' })
    expect((await readServerAggregate(db,'meal_logs',id))!.data).not.toBeNull(); expect((await readServerAggregate(db,'foods',f.source.id))!.data).not.toBeNull()
  })
})
