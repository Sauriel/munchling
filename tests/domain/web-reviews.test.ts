import { describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { binding,snapshot,url } from '../helpers/sync-wire'
import { createHttpDataService } from '../../app/utils/data/http'
import { syncLimits } from '../../shared/domain/protocol'
import type { WebState } from '../../shared/domain/web'

function setup(booked = true) {
  const f = mergeFixture(), roots = f.roots.filter(r => booked || r.entity !== 'meal_logs')
  const state: WebState = { snapshot: snapshot(roots),viewIds: snapshot(roots).identities.map((row,i) => ({ entity: row.entity,uuid: row.uuid,id: i+1 })) }
  const values = new Map<string,string>(),bodies: string[] = []
  const storage = { getItem: (k: string) => values.get(k) ?? null,setItem: (k: string,v: string) => { values.set(k,v) },removeItem: (k: string) => { values.delete(k) } }
  let lost = false,rejected = false,failView = false,rejectionCode = 'versionConflict'
  const response = (v: unknown,status = 200) => new Response(JSON.stringify(v),{ status,headers: { 'Content-Type': 'application/json' } })
  const fetcher: typeof fetch = async (input,init) => {
    if (String(input).endsWith('/info')) return response({ ...binding,protocolVersion: 1,schemaVersion: 4,cursor: '0',counts: [],capabilities: { authentication: 'none',fullAggregates: true,manualConflicts: true,atomicBatches: true },limits: syncLimits })
    if (String(input).includes('/view?')) { if (failView) throw new Error('offline'); return response(state) }
    const body = String(init?.body); bodies.push(body); const batch = JSON.parse(body)
    if (lost) throw new Error('lost')
    if (rejected) return response({ error: { code: rejectionCode,resync: false,retryable: false,current: [] } },409)
    return response({ ...binding,batchId: batch.batchId,cursor: '3',operations: batch.operations.map((op: any) => ({ operationId: op.operationId,entity: op.entity,entityUuid: op.entityUuid,serverRevision: 2 })),changes: batch.operations.map((op: any) => ({ entity: op.entity,entityUuid: op.entityUuid,serverRevision: 2 })) })
  }
  const service = () => createHttpDataService(url,storage,{ fetch: fetcher,lock: { run: async (_key,action) => action() } })
  const id = state.viewIds.find(row => row.uuid === f.source.id)!.id
  function change() { state.snapshot = snapshot(roots.map(r => r.id === f.source.id ? { ...r,version: 2,data: { ...r.data,name_de: 'Server changed',calories_per_100g: 101 } } : r)) }
  return { f,id,state,bodies,service,change,setLost: (v: boolean) => { lost = v },setRejected: (code = 'versionConflict') => { rejected = true; rejectionCode = code },setFailView: () => { failView = true } }
}
describe('web explicit reviews', () => {
  it('never sends a previewed deletion affecting historical meals, including UI tampering', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods()
    await expect(s.foods.deleteFood(t.id,1)).rejects.toThrow('deletionPreviewRequired')
    const review = s.getDeletionReview()!; expect(review.history).toHaveLength(2)
    review.history = []; review.root.version = 999
    await expect(s.confirmDeletion(review.token,true)).rejects.toThrow('historyConflict')
    expect(t.bodies).toEqual([])
  })
  it('requires an explicit original ticket and captures unchanged guards, policy and request bytes for replay', async () => {
    const t = setup(false),s = t.service(); await s.foods.listFoods()
    await expect(s.foods.deleteFood(t.id,1)).rejects.toThrow('deletionPreviewRequired')
    const review = s.getDeletionReview()!; await expect(s.confirmDeletion(review.token,false)).rejects.toThrow('confirmDeletion')
    await expect(s.confirmDeletion('wrong',true)).rejects.toThrow('deletionPreviewMissing')
    review.guards[0]!.baseRevision = 999; review.root.version = 999
    t.setLost(true); await expect(s.confirmDeletion(review.token,true)).rejects.toThrow('network')
    expect(s.hasPendingWrite()).toBe(true); const sent = JSON.parse(t.bodies[0]!)
    expect(sent.preserveHistory).toBe(true); expect(sent.operations[0].baseRevision).toBe(1); expect(sent.guards[0].baseRevision).toBe(1)
    t.setLost(false); await t.service().retryPendingWrite(); expect(t.bodies).toEqual([t.bodies[0],t.bodies[0]])
  })
  it('shows captured base, unchanged draft and server after proven non-commit, without replacing cached form revision', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods(); t.change(); t.setRejected()
    await expect(s.foods.updateFood(t.id,{ nameDe: 'My draft' },1)).rejects.toThrow('versionConflict')
    const review = s.getWriteConflict()!
    expect(review.rows[0]!.base!.data!.name_de).toBe('Source')
    expect((review.rows[0]!.draft as any).name_de).toBe('My draft')
    expect(review.rows[0]!.server!.data!.name_de).toBe('Server changed')
    expect((await s.foods.getFoodById(t.id))!.revision).toBe(1)
    expect(s.hasPendingWrite()).toBe(false)
  })
  it('retains original read evidence across a list refresh and never sends a stale local form', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods(); t.change(); await s.foods.listFoods()
    await expect(s.foods.updateFood(t.id,{ nameDe: 'My draft' },1)).rejects.toThrow('versionConflict')
    const review = s.getWriteConflict()!; expect(review.rows[0]!.base!.version).toBe(1)
    expect(review.rows[0]!.server!.version).toBe(2); expect(review.rows[0]!.draft).toEqual({ nameDe: 'My draft' })
    expect(t.bodies).toEqual([])
  })
  it('recovers original base evidence from the journal after restart and canonical rejection', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods(); t.setLost(true)
    await expect(s.foods.updateFood(t.id,{ nameDe: 'Saved draft' },1)).rejects.toThrow('network')
    t.setLost(false); t.change(); t.setRejected(); const next = t.service()
    await expect(next.retryPendingWrite()).rejects.toThrow('versionConflict')
    expect(next.getWriteConflict()!.rows[0]!.base!.data!.name_de).toBe('Source')
    expect((next.getWriteConflict()!.rows[0]!.draft as any).name_de).toBe('Saved draft')
    expect(t.bodies).toEqual([t.bodies[0],t.bodies[0]])
  })
  it('does not present an unavailable server read as deletion and settles canonical history rejection', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods(); t.setRejected('historyConflict'); t.setFailView()
    await expect(s.foods.updateFood(t.id,{ nameDe: 'Saved draft' },1)).rejects.toThrow('historyConflict')
    expect(s.getWriteConflict()!.serverAvailable).toBe(false); expect(s.hasPendingWrite()).toBe(false)
    expect((s.getWriteConflict()!.rows[0]!.draft as any).name_de).toBe('Saved draft')
  })
  it('does not classify a lost response as a conflict or remove its journal', async () => {
    const t = setup(),s = t.service(); await s.foods.listFoods(); t.setLost(true)
    await expect(s.foods.updateFood(t.id,{ nameDe: 'My draft' },1)).rejects.toThrow('network')
    expect(s.getWriteConflict()).toBeUndefined(); expect(s.hasPendingWrite()).toBe(true)
  })
})
