import { SyncClientError } from '../../../shared/domain/replies'
export type AutomaticSyncTrigger = 'start' | 'resume'
export type AutomaticSyncDependencies = {
  permitted: (trigger: AutomaticSyncTrigger, signal: AbortSignal) => Promise<boolean>
  run: (signal: AbortSignal) => Promise<void>
  onError?: (code: string) => void
}

// Lifecycle-independent coordinator. Construction never starts networking.
// Wiring to native lifecycle and the shared runner is a separate integration.
export function createAutomaticSyncCoordinator(deps: AutomaticSyncDependencies) {
  let started = false, observed = false, active = true, closed = false, pendingResume = false
  let current: AbortController | null = null
  async function trigger(event: AutomaticSyncTrigger) {
    if (closed || !active || current) return false
    const controller = new AbortController(); current = controller
    try {
      if (!await deps.permitted(event,controller.signal) || closed || !active || controller.signal.aborted) return false
      await deps.run(controller.signal)
      return !controller.signal.aborted
    } catch (cause) {
      if (!controller.signal.aborted && !closed) deps.onError?.(cause instanceof SyncClientError ? cause.code : 'localOrNetworkError')
      return false
    } finally {
      if (current === controller) current = null
      if (pendingResume && active && !closed) { pendingResume = false; void trigger('resume') }
    }
  }
  return {
    start: () => { if (started) return Promise.resolve(false); started = true; return trigger('start') },
    setActive: (value: boolean) => {
      const resume = observed && !active && value
      observed = true; active = value
      if (!value) { pendingResume = false; current?.abort() }
      if (resume && current?.signal.aborted) { pendingResume = true; return Promise.resolve(false) }
      return resume ? trigger('resume') : Promise.resolve(false)
    },
    cancel: () => { pendingResume = false; current?.abort() },
    close: () => { closed = true; pendingResume = false; current?.abort() },
  }
}
