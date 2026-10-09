import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { newDatabase, resetDatabase } from './helpers'
import { writeServerBatch } from '../../server/services/write'
import { readServerAggregate, previewServerDeletion } from '../../server/services/storage'
import { readServerState } from '../../server/database/state'
import type { ServerOperation, ServerWriteBatch } from '../../shared/domain/server'
import { createUuid } from '../../shared/domain/sync'
import { createTestDatabase } from '../helpers/sqlite'
import { createSyncQueue } from '../../app/utils/database/outbox'
import { createHttpDataService } from '../../app/utils/data/http'
import { readWebState } from '../../server/services/web'
import { serverInfo } from '../../server/services/read'

describe('MariaDB activity persistence, optimistic safety and SQLite outbox compatibility', () => {
  const db = newDatabase()
  beforeEach(async () => { await resetDatabase(db) }); afterAll(async () => { await db.close() })
  async function nativeBatch() {
    const local = await createTestDatabase()
    const p = (await local.service.profiles.createProfile({ name: 'P', dailyCaloriesTarget: 2000 }))!, q = (await local.service.profiles.createProfile({ name: 'Q', dailyCaloriesTarget: 1800 }))!, a = (await local.service.activities.createActivity({ name: 'Walk', durationMinutes: 30, calories: 200 }))!
    await local.service.activityLogs.createActivityLogs({ activityId: a.id, date: '2026-10-08', profiles: [{ profileId: p.id, units: 1.5 },{ profileId: q.id, units: 0.5 }] })
    const operations = (await createSyncQueue(local.database).list()).map(o => ({ operationId: o.operationId, entity: o.entity, entityUuid: o.entityUuid, operation: o.operation, payload: o.payload, baseRevision: o.baseRevision }))
    const state = await db.withConnection(sql => readServerState(sql))
    const request: ServerWriteBatch = { batchId: createUuid(), deviceId: createUuid(), serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid, operations, guards: [] }
    local.close(); return request
  }
  it('accepts atomic multi-profile SQLite snapshots and preserves them across template edits/deletion and idempotent replay', async () => {
    const request = await nativeBatch(), receipt = await writeServerBatch(db,request)
    expect(await writeServerBatch(db,request)).toEqual(receipt)
    const a = request.operations.find(o => o.entity === 'activities')!, logs = request.operations.filter(o => o.entity === 'activity_logs')
    const changed = { ...a, operationId: createUuid(), baseRevision: 1, payload: { ...a.payload, name: 'Changed', calories: 999 } }
    await writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [changed] })
    for (const log of logs) expect(await readServerAggregate(db,'activity_logs',log.entityUuid)).toMatchObject({ data: { calories: 200, date: '2026-10-08' } })
    await writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [{ ...a, operationId: createUuid(),baseRevision: 2, operation: 'delete', payload: { id: a.entityUuid,deleted_at: '2026-10-08T12:00:00Z' } }] })
    expect((await readServerAggregate(db,'activity_logs',logs[0]!.entityUuid))!.data!.units).toBe(1.5)
    const view = await readWebState(db,request); expect(view.snapshot.aggregates.filter(a => a.entity === 'activity_logs')).toHaveLength(2)
  })
  it('rejects a stale template guard and malformed dates without writing any partial logs', async () => {
    const request = await nativeBatch(); await writeServerBatch(db,request)
    const a = request.operations.find(o => o.entity === 'activities')!, log = request.operations.find(o => o.entity === 'activity_logs')!
    await writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [{ ...a,operationId: createUuid(),baseRevision: 1,payload: { ...a.payload,calories: 999 } }] })
    const newLog: ServerOperation = { ...log,operationId: createUuid(),entityUuid: createUuid() }; newLog.payload = { ...log.payload,id: newLog.entityUuid }
    await expect(writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [newLog], guards: [{ entity: 'activities',entityUuid: a.entityUuid,baseRevision: 1 }] })).rejects.toThrow()
    await expect(writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [{ ...newLog,payload: { ...newLog.payload,date: '2026-02-30' } }] })).rejects.toThrow()
    expect(await readServerAggregate(db,'activity_logs',newLog.entityUuid)).toBe(null)
  })
  it('writes online entries for multiple profiles as one guarded batch and exposes stable view IDs', async () => {
    const values = new Map<string,string>(), pushed: ServerWriteBatch[] = []
    const service = createHttpDataService('https://example.org', { getItem: key => values.get(key) ?? null, setItem: (key,value) => { values.set(key,value) }, removeItem: key => { values.delete(key) } }, { lock: { run: async (_key,work) => work() }, fetch: async (input,init) => {
      const url = new URL(String(input)); let body: unknown
      if (url.pathname.endsWith('info')) body = await serverInfo(db)
      else if (url.pathname.endsWith('view')) body = await readWebState(db,Object.fromEntries(url.searchParams))
      else { const request = JSON.parse(String(init!.body)) as ServerWriteBatch; pushed.push(request); body = await writeServerBatch(db,request) }
      return new Response(JSON.stringify(body),{ headers: { 'content-type': 'application/json' } })
    } })
    const p = (await service.profiles.createProfile({ name: 'P',dailyCaloriesTarget: 2000 }))!, q = (await service.profiles.createProfile({ name: 'Q',dailyCaloriesTarget: 1800 }))!, a = (await service.activities.createActivity({ name: 'Walk',durationMinutes: 30,calories: 200 }))!
    const logs = await service.activityLogs.createActivityLogs({ activityId: a.id,activityRevision: a.revision,date: '2026-10-08',profiles: [{ profileId: p.id,units: 1.5 },{ profileId: q.id,units: 0.5 }] })
    expect(logs).toHaveLength(2); expect(logs.find(l => l.profileId === p.id)).toMatchObject({ calories: 200,units: 1.5,date: '2026-10-08',revision: 1 })
    expect(pushed.at(-1)!.operations).toHaveLength(2); expect(pushed.at(-1)!.guards).toHaveLength(1); expect(values.size).toBe(0)
    await service.activities.updateActivity(a.id,{ name: 'Walk',durationMinutes: 30,calories: 999 },a.revision)
    await expect(service.activityLogs.createActivityLogs({ activityId: a.id,activityRevision: a.revision,date: '2026-10-08',profiles: [{ profileId: p.id,units: 1 }] })).rejects.toThrow('versionConflict')
    expect((await service.activityLogs.listActivityLogs()).every(l => l.calories === 200)).toBe(true)
  })
  it('includes daily logs in guarded profile cascade previews and retains their tombstones', async () => {
    const request = await nativeBatch(); await writeServerBatch(db,request)
    const p = request.operations.find(o => o.entity === 'profiles')!, preview = await previewServerDeletion(db,'profiles',p.entityUuid)
    expect(preview.dependents).toHaveLength(1); expect(preview.dependents[0]!.entity).toBe('activity_logs')
    const deletion: ServerOperation = { ...p,operationId: createUuid(),baseRevision: 1,operation: 'delete',payload: { id: p.entityUuid,deleted_at: '2026-10-08T12:00:00Z' } }
    await expect(writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [deletion] })).rejects.toThrow()
    await writeServerBatch(db,{ ...request,batchId: createUuid(),operations: [deletion],guards: preview.dependents.map(d => ({ entity: d!.entity,entityUuid: d!.id,baseRevision: d!.version })) })
    expect((await readServerAggregate(db,'activity_logs',preview.dependents[0]!.id))!.deletedAt).not.toBe(null)
  })
})
