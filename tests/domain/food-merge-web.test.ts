import { describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { binding,snapshot,url } from '../helpers/sync-wire'
import { createHttpDataService } from '../../app/utils/data/http'
import { syncLimits } from '../../shared/domain/protocol'
import type { WebState } from '../../shared/domain/web'

function setup() {
  const f = mergeFixture(), state: WebState = { snapshot: snapshot(f.roots),viewIds: snapshot(f.roots).identities.map((row,i) => ({ entity: row.entity,uuid: row.uuid,id: i+1 })) }
  const values = new Map<string,string>(), bodies: string[] = [], storage = { getItem: (k: string) => values.get(k) ?? null,setItem: (k: string,v: string) => { values.set(k,v) },removeItem: (k: string) => { values.delete(k) } }
  let lose = false, failRefresh = false, committed = false
  const respond = (v: unknown) => new Response(JSON.stringify(v),{ headers: { 'Content-Type': 'application/json' } })
  const fetcher: typeof fetch = async (input,init) => {
    if (String(input).endsWith('/info')) return respond({ ...binding,protocolVersion: 1,schemaVersion: 4,cursor: '0',counts: [],capabilities: { authentication: 'none',fullAggregates: true,manualConflicts: true,atomicBatches: true },limits: syncLimits })
    if (String(input).includes('/view?')) { if (committed && failRefresh) throw new Error('offline'); return respond(state) }
    const text = String(init!.body); bodies.push(text); const batch = JSON.parse(text); committed = true
    if (lose) throw new Error('lost')
    return respond({ ...binding,batchId: batch.batchId,cursor: '3',operations: batch.operations.map((op: any) => ({ operationId: op.operationId,entity: op.entity,entityUuid: op.entityUuid,serverRevision: 2 })),changes: batch.operations.map((op: any) => ({ entity: op.entity,entityUuid: op.entityUuid,serverRevision: 2 })) })
  }
  const service = () => createHttpDataService(url,storage,{ fetch: fetcher,lock: { run: async (_key,action) => action() } })
  const ids = (uuid: string) => state.viewIds.find(row => row.uuid === uuid)!.id
  return { f,state,bodies,storage,service,ids,setLost: (v: boolean) => { lose = v },setFailRefresh: (v: boolean) => { failRefresh = v } }
}
describe('web merge confirmation and immutable journal', () => {
  it('requires the shown ticket and explicit confirmation, and cannot alter the batch via returned UI objects', async () => {
    const t = setup(), s = t.service(), review = await s.foodMerges!.preview(t.ids(t.f.source.id),t.ids(t.f.target.id))
    expect(t.bodies).toEqual([])
    await expect(s.foodMerges!.commit(review.token,false)).rejects.toThrow('confirmMerge')
    await expect(s.foodMerges!.commit('wrong',true)).rejects.toThrow('mergePreviewMissing')
    review.source.id = t.f.target.id; review.target.calories_per_100g = 999
    await s.foodMerges!.commit(review.token,true)
    const sent = JSON.parse(t.bodies[0]!)
    expect(sent.operations.find((op: any) => op.operation === 'delete').entityUuid).toBe(t.f.source.id)
    expect(sent.operations.find((op: any) => op.entityUuid === t.f.target.id)).toMatchObject({ operation: 'upsert',baseRevision: 1,payload: t.f.target.data })
    await expect(s.foodMerges!.commit(review.token,true)).rejects.toThrow('mergePreviewMissing')
  })
  it('replays byte-identical captured requests across restart after a lost response and fences other writes', async () => {
    const t = setup(), s = t.service(), review = await s.foodMerges!.preview(t.ids(t.f.source.id),t.ids(t.f.target.id))
    t.setLost(true); await expect(s.foodMerges!.commit(review.token,true)).rejects.toThrow('network')
    expect(s.hasPendingWrite()).toBe(true)
    await expect(s.foodMerges!.preview(t.ids(t.f.source.id),t.ids(t.f.target.id))).rejects.toThrow('unconfirmedUpload')
    t.setLost(false); await t.service().retryPendingWrite(); expect(t.bodies).toEqual([t.bodies[0],t.bodies[0]])
  })
  it('does not resend a confirmed merge when only the post-receipt refresh failed', async () => {
    const t = setup(), s = t.service(), review = await s.foodMerges!.preview(t.ids(t.f.source.id),t.ids(t.f.target.id))
    t.setFailRefresh(true); await expect(s.foodMerges!.commit(review.token,true)).rejects.toThrow('network')
    t.setFailRefresh(false); await t.service().retryPendingWrite(); expect(t.bodies).toHaveLength(1)
  })
})
