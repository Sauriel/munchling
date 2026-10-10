import { describe, it, expect, vi } from 'vitest'
import { createAutomaticSyncCoordinator } from '../../app/utils/sync/automatic'
import { SyncClientError } from '../../shared/domain/replies'

describe('automatic sync lifecycle coordinator', () => {
  it('does nothing on construction, runs start once, and does not interpret initial active events as resume', async () => {
    const permitted = vi.fn(async () => true), run = vi.fn(async () => {})
    const c = createAutomaticSyncCoordinator({ permitted,run })
    expect(permitted).not.toHaveBeenCalled(); await c.setActive(true); expect(run).not.toHaveBeenCalled()
    expect(await c.start()).toBe(true); await c.start(); await c.setActive(true)
    expect(run).toHaveBeenCalledOnce(); expect(permitted).toHaveBeenCalledWith('start', expect.any(AbortSignal))
    await c.setActive(false); await c.setActive(true)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('checks each independent trigger and never runs when its policy is disabled', async () => {
    const run = vi.fn(async () => {})
    const c = createAutomaticSyncCoordinator({ permitted: async event => event === 'resume',run })
    expect(await c.start()).toBe(false); expect(run).not.toHaveBeenCalled()
    await c.setActive(false); expect(await c.setActive(true)).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })
  it('rejects concurrent lifecycle triggers while preflight is pending and cancels before any network on backgrounding', async () => {
    let release!: (v: boolean) => void
    const run = vi.fn(async () => {}), permitted = vi.fn(() => new Promise<boolean>(resolve => { release = resolve }))
    const c = createAutomaticSyncCoordinator({ permitted,run }), pending = c.start()
    await c.setActive(false); await c.setActive(true)
    expect(permitted).toHaveBeenCalledOnce(); release(true)
    expect(await pending).toBe(false); expect(run).not.toHaveBeenCalled()
    c.close(); release(false)
  })
  it('aborts running work on background or disposal and never emits an error for the cancellation', async () => {
    let signal!: AbortSignal, release!: () => void
    const onError = vi.fn(), c = createAutomaticSyncCoordinator({ permitted: async () => true,run: async s => { signal = s; await new Promise<void>(resolve => { release = resolve }) },onError })
    const pending = c.start(); await new Promise<void>(resolve => setImmediate(resolve))
    await c.setActive(false); expect(signal.aborted).toBe(true); release(); expect(await pending).toBe(false)
    c.close(); await c.setActive(true); expect(onError).not.toHaveBeenCalled()
  })
  it('queues one quick resume behind an aborted run without overlap', async () => {
    let release!: () => void
    const run = vi.fn(async () => { if (run.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve }) })
    const c = createAutomaticSyncCoordinator({ permitted: async () => true,run })
    await c.setActive(true); const first = c.start(); await new Promise<void>(resolve => setImmediate(resolve))
    await c.setActive(false); await c.setActive(true); expect(run).toHaveBeenCalledOnce()
    release(); expect(await first).toBe(false); await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    await c.setActive(true); expect(run).toHaveBeenCalledTimes(2); c.close()
  })
  it('contains failures without retry loops and reports only sanitized error codes', async () => {
    const onError = vi.fn(), run = vi.fn(async () => { throw new Error('private request data') })
    const c = createAutomaticSyncCoordinator({ permitted: async () => true,run,onError })
    expect(await c.start()).toBe(false); await c.start()
    expect(run).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledWith('localOrNetworkError')
    const typed = createAutomaticSyncCoordinator({ permitted: async () => true,run: async () => { throw new SyncClientError('serverChanged') },onError })
    await typed.start(); expect(onError).toHaveBeenLastCalledWith('serverChanged')
  })
})
