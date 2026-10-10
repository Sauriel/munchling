import { afterAll,beforeAll,beforeEach,describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { newDatabase,resetDatabase } from './helpers'
import type { ServerDatabase } from '../../server/database/connection'
import { readServerState } from '../../server/database/state'
import { readWebState } from '../../server/services/web'
import { readServerAggregate } from '../../server/services/storage'
import { writeServerBatch } from '../../server/services/write'
import { createUuid } from '../../shared/domain/sync'
import { deletionReview } from '../../shared/domain/deletion-review'
import type { ServerOperation,ServerAggregate } from '../../shared/domain/server'

describe('history-safe deletion under real MariaDB write lock', () => {
  let db: ServerDatabase
  beforeAll(() => { db = newDatabase() }); beforeEach(async () => { await resetDatabase(db) }); afterAll(async () => { await db.close() })
  async function request(operations: ServerOperation[]) {
    const s = await db.withConnection(readServerState)
    return { batchId: createUuid(),serverInstanceId: s.instance_uuid,serverEpoch: s.epoch_uuid,operations }
  }
  async function seed(rows: ServerAggregate[]) {
    await writeServerBatch(db,await request(rows.map(r => ({ operationId: createUuid(),entity: r.entity,entityUuid: r.id,baseRevision: 0,operation: 'upsert',payload: r.data! }))))
  }
  async function reviewBatch(root: ServerAggregate) {
    const s = await db.withConnection(readServerState), view = await readWebState(db,{ serverInstanceId: s.instance_uuid,serverEpoch: s.epoch_uuid })
    const review = deletionReview(view.snapshot.aggregates,root.entity,root.id)
    const batch = { ...await request([{ operationId: createUuid(),entity: root.entity,entityUuid: root.id,baseRevision: 1,operation: 'delete',payload: { id: root.id } }]),guards: review.guards,preserveHistory: true as const }
    return { view,batch }
  }
  function stable(view: Awaited<ReturnType<typeof readWebState>>) {
    return { aggregates: view.snapshot.aggregates,identities: view.snapshot.identities,cursor: view.snapshot.cursor,viewIds: view.viewIds }
  }
  async function cut(batch: { serverInstanceId: string; serverEpoch: string }) {
    return stable(await readWebState(db,{ serverInstanceId: batch.serverInstanceId,serverEpoch: batch.serverEpoch }))
  }
  it('rejects direct historical food deletion without changing any rows or cursor', async () => {
    const f = mergeFixture(); await seed(f.roots); const { view,batch } = await reviewBatch(f.source)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'historyConflict' })
    expect(await cut(batch)).toEqual(stable(view))
  })
  it('rejects a newly booked INDIRECT meal after preview even though direct dependency versions did not change', async () => {
    const f = mergeFixture(); await seed(f.roots.filter(r => r.entity !== 'meal_logs')); const { batch } = await reviewBatch(f.source)
    await seed([f.indirect]); const before = await cut(batch)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'historyConflict' })
    expect(await cut(batch)).toEqual(before)
    expect((await readServerAggregate(db,'recipes',f.r.id))!.version).toBe(1)
  })
  it('rejects an unseen new indirect recipe even when it has no bookings', async () => {
    const f = mergeFixture(); await seed(f.roots.filter(r => r.entity !== 'meal_logs')); const { batch } = await reviewBatch(f.source)
    const id = createUuid(), data = structuredClone(f.parent.data!); data.id = id
    data.ingredients = (data.ingredients as Record<string,unknown>[]).map(row => ({ ...row,id: createUuid(),recipe_id: id,sub_recipe_id: f.parent.id }))
    await seed([{ ...f.parent,id,data }]); const before = await cut(batch)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'dependencyConflict' })
    expect(await cut(batch)).toEqual(before)
  })
  it('rejects a changed original indirect guard without rebasing', async () => {
    const f = mergeFixture(); await seed(f.roots.filter(r => r.entity !== 'meal_logs')); const { batch } = await reviewBatch(f.source)
    await writeServerBatch(db,await request([{ operationId: createUuid(),entity: 'recipes',entityUuid: f.parent.id,baseRevision: 1,operation: 'upsert',payload: { ...f.parent.data,name_de: 'Changed parent' } }]))
    const before = await cut(batch); await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'dependencyConflict' }); expect(await cut(batch)).toEqual(before)
  })
  it('allows an unbooked cascade with original guard versions and exact receipt replay', async () => {
    const f = mergeFixture(); await seed(f.roots.filter(r => r.entity !== 'meal_logs')); const { batch } = await reviewBatch(f.source)
    const receipt = await writeServerBatch(db,batch); expect(await writeServerBatch(db,structuredClone(batch))).toEqual(receipt)
    expect((await readServerAggregate(db,'foods',f.source.id))!.data).toBeNull()
    expect((await readServerAggregate(db,'recipes',f.r.id))!.data!.ingredients).toEqual([])
    expect((await readServerAggregate(db,'recipes',f.parent.id))!.version).toBe(1)
  })
  it('rejects stale guards and new unpreviewed direct references atomically', async () => {
    const f = mergeFixture(); await seed(f.roots.filter(r => r.entity !== 'meal_logs')); const { batch } = await reviewBatch(f.source)
    await seed([f.direct]); const before = await cut(batch)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'dependencyConflict' })
    expect(await cut(batch)).toEqual(before)
  })
  it('does not allow a mixed batch to erase history before the protection check', async () => {
    const f = mergeFixture(); await seed(f.roots); const { batch } = await reviewBatch(f.source)
    batch.guards = batch.guards.filter(g => g.entityUuid !== f.direct.id && g.entityUuid !== f.indirect.id)
    for (const r of [f.direct,f.indirect]) batch.operations.unshift({ operationId: createUuid(),entity: r.entity,entityUuid: r.id,baseRevision: 1,operation: 'delete',payload: { id: r.id } })
    const before = await cut(batch)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'historyConflict' })
    expect(await cut(batch)).toEqual(before)
  })
  it('protects profile activity history while template deletion retains independent logs', async () => {
    const f = mergeFixture(), id = createUuid(), template: ServerAggregate = { entity: 'activities',id,version: 1,deletedAt: null,data: { id,name: 'Walk',duration_minutes: 15,calories: 25,created_at: '2026-01-01T12:00:00Z',updated_at: null } }
    const logId = createUuid(), log: ServerAggregate = { entity: 'activity_logs',id: logId,version: 1,deletedAt: null,data: { ...template.data,id: logId,profile_id: f.p.id,date: '2026-01-02',units: 0.5 } }
    await seed([f.p,template,log]); const { batch } = await reviewBatch(f.p)
    await expect(writeServerBatch(db,batch)).rejects.toMatchObject({ code: 'historyConflict' })
    const { batch: removeTemplate } = await reviewBatch(template)
    const before = await readServerAggregate(db,'activity_logs',logId)
    await writeServerBatch(db,removeTemplate)
    expect(await readServerAggregate(db,'activity_logs',logId)).toEqual(before)
    expect((await readServerAggregate(db,'activity_logs',logId))!.version).toBe(1)
  })
})
