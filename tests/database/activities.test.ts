import { describe, it, expect, vi } from 'vitest'
import { createTestDatabase } from '../helpers/sqlite'
import { createSyncQueue } from '../../app/utils/database/outbox'
import { activityBonus, activityTotals } from '../../shared/domain/activities'
import { createSqlDatabase } from '../../app/utils/database/executor'
import { runLocalMigrations } from '../../app/utils/database/migrations'
import { migrationChecksum } from '../../server/database/migrations'
import { serverMigrations } from '../../server/database/schema'

import { createSnapshotStaging } from '../../app/utils/sync/staging'
import { createRemoteReceiver } from '../../app/utils/sync/apply'
import { profile, snapshot, page, binding, date, url } from '../helpers/sync-wire'
import { createUuid } from '../../shared/domain/sync'
import type { ServerAggregate } from '../../shared/domain/server'

const input = { name: 'Cycling', durationMinutes: 30, calories: 200 }
describe('activities, daily allowances and safety', () => {
  it('atomically records different units per profile and freezes historical template values', async () => {
    const d = await createTestDatabase()
    try {
      const p = (await d.service.profiles.createProfile({ name: 'P', dailyCaloriesTarget: 2000 }))!, q = (await d.service.profiles.createProfile({ name: 'Q', dailyCaloriesTarget: 1800 }))!
      const a = (await d.service.activities.createActivity(input))!
      const logs = await d.service.activityLogs.createActivityLogs({ activityId: a.id, activityRevision: a.revision, date: '2026-10-08', profiles: [{ profileId: p.id, units: 1.5 }, { profileId: q.id, units: 0.5 }] })
      expect(activityBonus(logs,p.id,'2026-10-08')).toBe(300); expect(activityBonus(logs,q.id,'2026-10-08')).toBe(100); expect(activityBonus(logs,p.id,'2026-10-09')).toBe(0)
      expect(activityTotals(logs[0]!, logs[0]!.units).durationMinutes).toBe(45)
      const batch = (await createSyncQueue(d.database).list()).filter(o => o.entity === 'activity_logs'); expect(new Set(batch.map(o => o.batchId)).size).toBe(1)
      expect(batch[0]!.payload.profile_id).not.toBe(p.id)
      await d.service.activities.updateActivity(a.id, { ...input, calories: 999 })
      await expect(d.service.activityLogs.createActivityLogs({ activityId: a.id, activityRevision: a.revision, date: '2026-10-08', profiles: [{ profileId: p.id, units: 1 }] })).rejects.toThrow('versionConflict')
      await d.service.activities.deleteActivity(a.id)
      expect(activityBonus(await d.service.activityLogs.listActivityLogs(),p.id,'2026-10-08')).toBe(300)
      const backup = await d.service.backups!.exportBackup(); expect(backup.version).toBe(4)
      await d.service.backups!.restoreBackup(backup, async () => {})
      expect(await d.service.activityLogs.listActivityLogs()).toEqual(logs.slice().reverse())
      await d.service.activityLogs.deleteActivityLog(logs[0]!.id)
      expect(activityBonus(await d.service.activityLogs.listActivityLogs(),p.id,'2026-10-08')).toBe(0)
      expect((await d.service.profiles.getProfileById(p.id))!.dailyCaloriesTarget).toBe(2000)
    } finally { d.close() }
  })
  it('rolls back the entire multi-profile request including its outbox on a late invalid profile', async () => {
    const d = await createTestDatabase()
    try {
      const p = (await d.service.profiles.createProfile({ name: 'P', dailyCaloriesTarget: 2000 }))!, a = (await d.service.activities.createActivity(input))!
      const queue = await createSyncQueue(d.database).list()
      await expect(d.service.activityLogs.createActivityLogs({ activityId: a.id, date: '2026-10-08', profiles: [{ profileId: p.id, units: 1 }, { profileId: 9999, units: 2 }] })).rejects.toThrow()
      expect(await d.service.activityLogs.listActivityLogs()).toEqual([]); expect(await createSyncQueue(d.database).list()).toEqual(queue)
      await expect(d.service.activityLogs.createActivityLogs({ activityId: a.id, date: '2026-02-30', profiles: [{ profileId: p.id, units: 1 }] })).rejects.toThrow()
      expect(() => activityTotals(input,Infinity)).toThrow()
      await d.service.activityLogs.createActivityLogs({ activityId: a.id, date: '2026-10-08', profiles: [{ profileId: p.id, units: 1 }] })
      await d.service.profiles.deleteProfile(p.id)
      expect(await d.service.activityLogs.listActivityLogs()).toEqual([])
      expect((await createSyncQueue(d.database).list()).some(o => o.entity === 'activity_logs' && o.operation === 'delete')).toBe(true)
    } finally { d.close() }
  })
  it('rolls back v6 DDL and preserves v5 business data, identities and pending requests when upgrading', async () => {
    const d = await createTestDatabase({ version: 5 })
    try {
      await d.service.profiles.createProfile({ name: 'Legacy', dailyCaloriesTarget: 2000 })
      const old = await d.service.backups!.exportBackup(), queue = await createSyncQueue(d.database).list(), execute = d.driver.execute
      const spy = vi.spyOn(d.driver,'execute').mockImplementation((sql,tx) => execute(sql.includes('CREATE TABLE activities') ? sql+'INSERT INTO missing_table VALUES(1);' : sql,tx))
      await expect(runLocalMigrations(createSqlDatabase(d.driver),async () => {})).rejects.toThrow(); spy.mockRestore()
      expect(await d.database.query("SELECT name FROM sqlite_master WHERE name='activities';")).toEqual([])
      await runLocalMigrations(createSqlDatabase(d.driver),async () => {})
      expect((await d.service.backups!.exportBackup()).data).toEqual(old.data); expect(await createSyncQueue(d.database).list()).toEqual(queue)
      await d.service.backups!.restoreBackup(old,async () => {}); expect(await d.service.activities.listActivities()).toEqual([])
    } finally { d.close() }
  })
  it('receives activity snapshots without echoes and blocks profile deletion over a local-only daily entry', async () => {
    const d = await createTestDatabase()
    try {
      const p = profile(), id = createUuid(), logId = createUuid()
      const a: ServerAggregate = { entity: 'activities', id, version: 1, deletedAt: null, data: { id,name: input.name,duration_minutes: 30,calories: 200,created_at: date,updated_at: null } }
      const l: ServerAggregate = { entity: 'activity_logs', id: logId, version: 1, deletedAt: null, data: { id: logId,profile_id: p.id,date: '2026-10-08',name: input.name,duration_minutes: 30,calories: 200,units: 0.5,created_at: date,updated_at: null } }
      const stage = createSnapshotStaging(d.database), localEpoch = (await stage.state()).localEpoch, receiver = createRemoteReceiver(d.database)
      await stage.begin(localEpoch,url,snapshot([l,a,p])); expect((await receiver.adoptSnapshot(localEpoch)).status).toBe('applied')
      const localP = (await d.service.profiles.listProfiles())[0]!, localA = (await d.service.activities.listActivities())[0]!
      expect(activityBonus(await d.service.activityLogs.listActivityLogs(),localP.id,'2026-10-08')).toBe(100)
      expect(await createSyncQueue(d.database).list()).toEqual([])
      await d.service.activityLogs.createActivityLogs({ activityId: localA.id, date: '2026-10-08', profiles: [{ profileId: localP.id, units: 1 }] })
      const queue = await createSyncQueue(d.database).list(), context = { ...binding, localEpoch, url, cursor: '0' }
      expect((await receiver.applyPage(context,page([{ ...p, version: 2, data: null, deletedAt: date }])))[0]!.status).toBe('blocked')
      expect(await createSyncQueue(d.database).list()).toEqual(queue); expect(await d.service.activityLogs.listActivityLogs()).toHaveLength(2)
    } finally { d.close() }
  })
  it('does not rewrite published MariaDB migrations', () => {
    expect(serverMigrations.slice(0,3).map(m => migrationChecksum(m.statements))).toEqual(['7cef9035727b0acbb43ca1183f6ce1cb8e4fe0f32e404b5f87be44e172a64118','7f1b636631d3bc8ee57a1bdc24eb400008789c26228c56d81820d0e197cfc037','08dd1bc6ee61932cc4ed2a08f4fc9be5391abb8fbac15c7605438049eb32570a'])
  })
})
