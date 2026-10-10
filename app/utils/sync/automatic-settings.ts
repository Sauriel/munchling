import type { SqlDatabase, SqlExecutor } from '../database/executor'
import { receiveState } from './staging'
import { SyncClientError } from '../../../shared/domain/replies'

export type AutomaticSyncOptions = { onStart: boolean; onResume: boolean }
type Stored = { on_start: number; on_resume: number; server_url: string | null; local_epoch: string | null; server_instance_id: string | null; server_epoch: string | null }

async function context(sql: SqlExecutor) {
  const state = await receiveState(sql)
  const trust = (await sql.query<{ trusted_url: string | null; trusted_epoch: string | null }>('SELECT trusted_url,trusted_epoch FROM sync_state WHERE id=1;'))[0]!
  const staged = (await sql.query('SELECT id FROM sync_download LIMIT 1;')).length > 0
  // The legacy enabled flag remains false even after explicit manual reconciliation.
  const eligible = !state.seeded && Boolean(state.url && state.serverInstanceId && state.serverEpoch) && state.cursor !== null && !staged && trust.trusted_url === state.url && trust.trusted_epoch === state.localEpoch
  return { state, eligible }
}

// Device-only configuration: not an aggregate, not uploaded or included in backups.
// Rebinding/restoring/revoking trust makes previous opt-ins ineffective.
export function createAutomaticSyncSettings(db: SqlDatabase) {
  return {
    read: () => db.transaction(async sql => {
      const { state, eligible } = await context(sql)
      const saved = (await sql.query<Stored>('SELECT * FROM sync_automatic_preferences WHERE id=1;'))[0]!
      const same = eligible && saved.server_url === state.url && saved.local_epoch === state.localEpoch && saved.server_instance_id === state.serverInstanceId && saved.server_epoch === state.serverEpoch
      return { eligible, onStart: same && saved.on_start === 1, onResume: same && saved.on_resume === 1 }
    }),
    configure: (options: AutomaticSyncOptions) => db.transaction(async sql => {
      if (typeof options.onStart !== 'boolean' || typeof options.onResume !== 'boolean') throw new TypeError('Automatic sync options must be booleans')
      const { state, eligible } = await context(sql)
      if ((options.onStart || options.onResume) && !eligible) throw new SyncClientError('confirmSync')
      await sql.run('UPDATE sync_automatic_preferences SET on_start=?,on_resume=?,server_url=?,local_epoch=?,server_instance_id=?,server_epoch=? WHERE id=1;', [options.onStart,options.onResume,state.url,state.localEpoch,state.serverInstanceId,state.serverEpoch])
    }),
  }
}
