import type { ServerAggregate,ServerWriteBatch } from '../../../shared/domain/server'

export type WebConflictRow = { entity: string; id: string; revision: number; base: ServerAggregate | null; draft: unknown; raw: boolean; server: ServerAggregate | null }
export type WebConflict = { code: string; rows: WebConflictRow[]; serverAvailable: boolean }
/** Bounded read history for forms that remain open while another list refreshes.
 * It is display evidence only: never a replacement write base. */
export function createWebReviews() {
  const history = new Map<string,{ row: ServerAggregate; bytes: number }>(); let bytes = 0
  let conflict: WebConflict | undefined
  const key = (id: string,revision: number) => `${id}:${revision}`
  function remember(previous: Map<string,ServerAggregate> | undefined, next: Map<string,ServerAggregate>) {
    for (const row of previous?.values() ?? []) {
      if (next.get(row.id)?.version === row.version) continue
      const k = key(row.id,row.version); if (history.has(k)) continue
      const size = new TextEncoder().encode(JSON.stringify(row)).length
      if (size > 4 * 1024 * 1024) continue
      history.set(k,{ row: structuredClone(row),bytes: size }); bytes += size
      while (bytes > 4 * 1024 * 1024 || history.size > 1000) {
        const first = history.keys().next().value!; bytes -= history.get(first)!.bytes; history.delete(first)
      }
    }
  }
  function base(current: Map<string,ServerAggregate>, id: string,revision: number) {
    const row = current.get(id)
    return structuredClone(row?.version === revision ? row : history.get(key(id,revision))?.row ?? null)
  }
  function bases(current: Map<string,ServerAggregate>, operations: readonly { entityUuid: string; baseRevision: number }[]) {
    return operations.map(op => base(current,op.entityUuid,op.baseRevision))
  }
  function local(current: Map<string,ServerAggregate>, entity: string,id: string,revision: number,draft: unknown) {
    conflict = { code: 'versionConflict',serverAvailable: true,rows: [{ entity,id,revision,base: base(current,id,revision),draft: structuredClone(draft),raw: true,server: structuredClone(current.get(id) ?? null) }] }
  }
  function rejected(batch: ServerWriteBatch, original: (ServerAggregate | null)[] | undefined, code: string,server: ServerAggregate[] | null, changed: ServerAggregate[] = []) {
    const entries = [...batch.operations,...(batch.guards ?? [])]
    const rows: WebConflictRow[] = entries.map((op,i) => ({ entity: op.entity,id: op.entityUuid,revision: op.baseRevision,base: original?.[i] ?? null,draft: 'payload' in op ? structuredClone(op.payload) : null,raw: false,server: structuredClone(server?.find(row => row.id === op.entityUuid) ?? changed.find(row => row.id === op.entityUuid) ?? null) }))
    for (const row of changed) if (!rows.some(item => item.id === row.id)) rows.push({ entity: row.entity,id: row.id,revision: -1,base: null,draft: null,raw: false,server: structuredClone(row) })
    conflict = { code,serverAvailable: server !== null,rows }
  }
  return { remember,bases,local,rejected,get: () => conflict,clear: () => { conflict = undefined } }
}
