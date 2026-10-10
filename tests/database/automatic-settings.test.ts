import { describe, it, expect } from 'vitest'
import { createTestDatabase } from '../helpers/sqlite'
import { createAutomaticSyncSettings } from '../../app/utils/sync/automatic-settings'
import { createSyncAddressSettings } from '../../app/utils/sync/address'
import { createUuid } from '../../shared/domain/sync'
import { createSqlDatabase } from '../../app/utils/database/executor'
import { runLocalMigrations } from '../../app/utils/database/migrations'

async function bind(db: Parameters<typeof createAutomaticSyncSettings>[0]) {
  await db.run('UPDATE sync_state SET enabled=0,server_url=?,server_instance_id=?,server_epoch=?,pull_cursor=? WHERE id=1;', ['https://a.test',createUuid(),createUuid(),'0'])
  await createSyncAddressSettings(db).trust('https://a.test')
}
describe('device automatic sync preferences', () => {
  it('defaults off and requires a completed trusted binding, not just a remembered address', async () => {
    const a = await createTestDatabase()
    try {
      const prefs = createAutomaticSyncSettings(a.database)
      expect(await prefs.read()).toEqual({ eligible: false,onStart: false,onResume: false })
      await createSyncAddressSettings(a.database).trust('https://a.test')
      await expect(prefs.configure({ onStart: true,onResume: false })).rejects.toThrow('confirmSync')
      await bind(a.database); expect(await prefs.read()).toEqual({ eligible: true,onStart: false,onResume: false })
      await prefs.configure({ onStart: false,onResume: true }); expect((await prefs.read()).onResume).toBe(true)
      expect((await prefs.read()).onStart).toBe(false)
    } finally { a.close() }
  })
  it('persists the independent switches across restart, but never exports them or changes the outbox', async () => {
    const a = await createTestDatabase(); let b: typeof a | undefined
    try {
      await bind(a.database); const queue = await a.database.query('SELECT * FROM sync_outbox;')
      await createAutomaticSyncSettings(a.database).configure({ onStart: true,onResume: false })
      b = await createTestDatabase({ bytes: a.exportBytes() })
      expect(await createAutomaticSyncSettings(b.database).read()).toEqual({ eligible: true,onStart: true,onResume: false })
      expect(await b.database.query('SELECT * FROM sync_outbox;')).toEqual(queue)
      const backup = await b.service.backups!.exportBackup()
      expect(JSON.stringify(backup)).not.toContain('on_start')
      expect(JSON.stringify(backup)).not.toContain('https://a.test')
    } finally { a.close(); b?.close() }
  })
  it('does not resurrect automatic opt-ins after revoking and granting the same trust again', async () => {
    const a = await createTestDatabase()
    try {
      await bind(a.database); const prefs = createAutomaticSyncSettings(a.database), addresses = createSyncAddressSettings(a.database)
      await prefs.configure({ onStart: true,onResume: true }); await addresses.revoke()
      expect(await prefs.read()).toEqual({ eligible: false,onStart: false,onResume: false })
      await addresses.trust('https://a.test')
      expect(await prefs.read()).toEqual({ eligible: true,onStart: false,onResume: false })
    } finally { a.close() }
  })
  it.each([
    'UPDATE sync_state SET local_epoch=? WHERE id=1;',
    'UPDATE sync_state SET server_epoch=? WHERE id=1;',
    'UPDATE sync_state SET server_instance_id=? WHERE id=1;',
  ])('invalidates flags for changed binding (%s) and permits disabling them', async statement => {
    const a = await createTestDatabase()
    try {
      await bind(a.database); const prefs = createAutomaticSyncSettings(a.database)
      await prefs.configure({ onStart: true,onResume: true })
      await a.database.run(statement,[createUuid()])
      expect((await prefs.read()).onStart).toBe(false); expect((await prefs.read()).onResume).toBe(false)
      await prefs.configure({ onStart: false,onResume: false })
    } finally { a.close() }
  })
  it('upgrades v7 with both switches off and preserves data, trust, and queue', async () => {
    const a = await createTestDatabase({ version: 7 })
    try {
      await a.service.profiles.createProfile({ name: 'Existing',dailyCaloriesTarget: 2000 })
      await bind(a.database)
      const before = await a.service.backups!.exportBackup(), queue = await a.database.query('SELECT * FROM sync_outbox;')
      await runLocalMigrations(createSqlDatabase(a.driver),async () => {})
      expect(await createAutomaticSyncSettings(a.database).read()).toEqual({ eligible: true,onStart: false,onResume: false })
      expect((await a.service.backups!.exportBackup()).data).toEqual(before.data)
      expect(await a.database.query('SELECT * FROM sync_outbox;')).toEqual(queue)
    } finally { a.close() }
  })
  it('restore leaves automatic flags ineffective even after renewed address consent', async () => {
    const a = await createTestDatabase()
    try {
      await bind(a.database); const prefs = createAutomaticSyncSettings(a.database)
      await prefs.configure({ onStart: true,onResume: true })
      const backup = await a.service.backups!.exportBackup(); await a.service.backups!.restoreBackup(backup,async () => {})
      await bind(a.database)
      expect(await prefs.read()).toEqual({ eligible: true,onStart: false,onResume: false })
    } finally { a.close() }
  })
})
