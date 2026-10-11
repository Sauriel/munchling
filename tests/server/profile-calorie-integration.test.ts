import { afterAll,beforeAll,beforeEach,describe,it,expect } from 'vitest'
import { newDatabase,resetDatabase } from './helpers'
import type { ServerDatabase } from '../../server/database/connection'
import { readServerState } from '../../server/database/state'
import { writeServerBatch } from '../../server/services/write'
import { createServerSnapshot,readServerChanges } from '../../server/services/read'
import { profile } from '../helpers/sync-wire'
import { createUuid } from '../../shared/domain/sync'
import { configureProfileCalories,recordProfileWeight } from '../../shared/domain/profile-calorie-history'
import { encodeProfileCalorieEvent } from '../../shared/domain/profile-calorie-wire'
import type { ServerBinding } from '../../shared/domain/protocol'
describe('production profile calorie aggregate writes',() => {
  let db: ServerDatabase,binding: ServerBinding
  beforeAll(() => { db = newDatabase() })
  beforeEach(async () => { await resetDatabase(db); const state = await db.withConnection(readServerState); binding = { serverInstanceId: state.instance_uuid,serverEpoch: state.epoch_uuid } })
  afterAll(async () => { await db.close() })
  function fixture() {
    const p = profile(),context = { profileId: p.id,today: '2026-10-11',manualTargetKcal: 2000,history: [] }
    const event = configureProfileCalories(context,{ mode: 'automatic',model: { weightKg: 70,sleepHoursPerDay: 8,workKind: 'none',workHoursPerWeek: 0,sports: [],deficit: { mode: 'absolute',value: 0 } },measuredOn: context.today })
    return { p,event,context,payload: { ...p.data!,calorie_history: [encodeProfileCalorieEvent(event)] } }
  }
  function batch(payload: Record<string,unknown>,baseRevision = 0) { return { ...binding,batchId: createUuid(),operations: [{ operationId: createUuid(),entity: 'profiles',entityUuid: String(payload.id),baseRevision,operation: 'upsert',payload }] } }
  it('includes exact history bytes in snapshots, registry and atomic changefeed; replay never advances children',async () => {
    const f = fixture(),request = batch(f.payload),receipt = await writeServerBatch(db,request)
    expect(await writeServerBatch(db,request)).toEqual(receipt)
    const first = await db.withConnection(sql => sql.query('SELECT * FROM profile_calorie_history'))
    const snapshot = await createServerSnapshot(db,binding)
    expect(snapshot.aggregates[0]!.data).toEqual(f.payload)
    expect(snapshot.identities.find(row => row.uuid === f.event.id)).toMatchObject({ entity: 'profile_calorie_history',aggregateUuid: f.p.id,version: 1 })
    expect((await readServerChanges(db,binding,'0')).batches[0]!.changes[0]!.aggregate.data).toEqual(f.payload)
    await writeServerBatch(db,batch({ ...f.payload,name: 'Renamed' },1))
    expect(await db.withConnection(sql => sql.query('SELECT * FROM profile_calorie_history'))).toEqual(first)
  })
  it('appends a weight while preserving old goals and rejects removed or reformatted children atomically',async () => {
    const f = fixture(); await writeServerBatch(db,batch(f.payload))
    const next = recordProfileWeight({ ...f.context,history: [f.event],today: '2026-10-12' },{ weightKg: 80,measuredOn: '2026-10-12' })
    const payload = { ...f.payload,calorie_history: [...f.payload.calorie_history,encodeProfileCalorieEvent(next)] }
    await writeServerBatch(db,batch(payload,1))
    for (const calorie_history of [[],payload.calorie_history.map(row => ({ ...row,event_json: JSON.stringify(JSON.parse(row.event_json),null,2) }))]) {
      await expect(writeServerBatch(db,batch({ ...payload,name: 'Must rollback',calorie_history },2))).rejects.toMatchObject({ code: 'historyImmutable' })
    }
    const cut = await createServerSnapshot(db,binding)
    expect(cut.aggregates[0]!.data!.calorie_history).toEqual(payload.calorie_history)
    expect(cut.aggregates[0]!.data!.name).toBe(f.payload.name)
    expect(cut.cursor).toBe('2')
  })
  it('fences NEW legacy-client writes but replays already committed original requests before the capability gate',async () => {
    const f = fixture(),request = batch(f.payload)
    await expect(writeServerBatch(db,request,0)).rejects.toMatchObject({ code: 'protocolMismatch' })
    expect((await createServerSnapshot(db,binding)).aggregates).toEqual([])
    const receipt = await writeServerBatch(db,request,5)
    expect(await writeServerBatch(db,request,0)).toEqual(receipt)
    expect(await writeServerBatch(db,request,4)).toEqual(receipt)
    await expect(writeServerBatch(db,batch({ ...f.payload,name: 'Legacy update' },1),4)).rejects.toMatchObject({ code: 'protocolMismatch' })
    expect((await createServerSnapshot(db,binding)).aggregates[0]!.data!.name).toBe(f.payload.name)
  })
  it('explicit profile deletion tombstones history identities and does not allow UUID resurrection',async () => {
    const f = fixture(); await writeServerBatch(db,batch(f.payload))
    const deletion = { ...binding,batchId: createUuid(),operations: [{ operationId: createUuid(),entity: 'profiles',entityUuid: f.p.id,baseRevision: 1,operation: 'delete',payload: { id: f.p.id } }] }
    await writeServerBatch(db,deletion)
    const snapshot = await createServerSnapshot(db,binding)
    expect(snapshot.aggregates[0]!.data).toBeNull()
    expect(snapshot.identities.find(row => row.uuid === f.event.id)).toMatchObject({ version: 2,deletedAt: expect.any(String) })
    await expect(writeServerBatch(db,batch(f.payload,2))).rejects.toMatchObject({ code: 'identityConflict' })
  })
})
