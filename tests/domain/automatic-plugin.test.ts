import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { createAutomaticSyncCoordinator } from '../../app/utils/sync/automatic'

function plugin(native = true) {
  let mounted!: () => Promise<void>, cleanup!: () => void, event!: (state: { isActive: boolean }) => void
  const location = { pathname: '/' }, document = { querySelector: vi.fn((): object | null => null) }
  const options = { eligible: true,onStart: false,onResume: true }, status = ref({ busy: false,error: '',completed: false })
  const read = vi.fn(async () => ({ ...options })), remove = vi.fn(async () => {})
  const sync = vi.fn(async (_confirmed: boolean,_signal: AbortSignal,authorize: () => Promise<boolean>) => { if (!await authorize()) throw new Error('not permitted') })
  let guard!: (to: object) => Promise<void>, after!: (to: object) => void
  const removeGuard = vi.fn(), removeAfter = vi.fn()
  const router = { beforeEach: (callback: typeof guard) => { guard = callback; return removeGuard },afterEach: (callback: typeof after) => { after = callback; return removeAfter } }
  const selectedRecipe = ref<{ id: number; marker: string } | null>(null), getRecipeWithIngredients = vi.fn(async (id: number) => ({ id,marker: 'fresh' }))
  const refresh = vi.fn(async () => {})
  const data = { selectedRecipe,refreshProfiles: refresh,refreshFoods: refresh,refreshRecipes: refresh,refreshMealLogs: refresh,refreshActivities: refresh }
  const imports: Record<string, unknown> = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native } },
    '@capacitor/app': { App: { addListener: vi.fn(async (_name: string,callback: typeof event) => { event = callback; return { remove } }),getState: async () => ({ isActive: true }) } },
    '~/utils/sync/automatic': { createAutomaticSyncCoordinator },
    '~/utils/sync/automatic-settings': { createAutomaticSyncSettings: () => ({ read }) },
    '~/utils/sync/runner': { createManualSyncRunner: () => ({ sync }) },
    '~/utils/database/sql': { databaseSql: {} },
  }
  // HMR is bundler-only; all production setup/lifecycle code runs unchanged.
  const source = readFileSync(new URL('../../app/plugins/automatic-sync.client.ts',import.meta.url),'utf8').replace('import.meta.hot?.dispose(cleanup)','')
  const output = transpileModule(source,{ compilerOptions: { module: ModuleKind.CommonJS,target: ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  new Script(output).runInNewContext({ exports,require: (name: string) => { if (!(name in imports)) throw new Error('Unexpected dependency'); return imports[name] },defineNuxtPlugin: (value: unknown) => value,useRuntimeConfig: () => ({ public: { dataMode: native ? 'local' : 'online' } }),useState: () => status,useRouter: () => router,useMunchlingData: () => ({ recipes: { getRecipeWithIngredients } }),useProfiles: () => data,useFoods: () => data,useRecipes: () => data,useMealLogs: () => data,useActivities: () => data,location,document })
  exports.default.setup({ vueApp: { onUnmount: (callback: typeof cleanup) => { cleanup = callback } },hook: (_name: string,callback: typeof mounted) => { mounted = callback } })
  return { options,status,read,sync,refresh,remove,removeGuard,removeAfter,selectedRecipe,getRecipeWithIngredients,guard: (to: object) => guard(to),after: (to: object) => after(to),location,document,mount: () => mounted?.(),event: (active: boolean) => event({ isActive: active }),close: () => cleanup?.() }
}
describe('real native automatic plugin lifecycle', () => {
  it('never reads SQLite policy or registers lifecycle networking in online web mode', async () => {
    const p = plugin(false); await p.mount(); expect(p.read).not.toHaveBeenCalled(); expect(p.sync).not.toHaveBeenCalled()
  })
  it('keeps startup disabled independently, syncs on resume, refreshes data and removes its listener', async () => {
    const p = plugin()
    await p.mount(); expect(p.sync).not.toHaveBeenCalled()
    p.event(false); p.event(true); await vi.waitFor(() => expect(p.status.value.completed).toBe(true))
    expect(p.sync).toHaveBeenCalledOnce(); expect(p.refresh).toHaveBeenCalledTimes(5)
    p.close(); expect(p.remove).toHaveBeenCalledOnce()
    p.event(false); p.event(true); expect(p.sync).toHaveBeenCalledOnce()
  })
  it('drains cancelled receive work and refreshes cached selections before opening an editor', async () => {
    const p = plugin(); await p.mount()
    let release!: () => void, signal!: AbortSignal
    p.selectedRecipe.value = { id: 7,marker: 'old' }
    p.sync.mockImplementationOnce(async (_confirmed,s) => { signal = s; await new Promise<void>(resolve => { release = resolve }) })
    p.event(false); p.event(true); await vi.waitFor(() => expect(p.status.value.busy).toBe(true))
    const to = {}, navigation = p.guard(to); expect(signal.aborted).toBe(true)
    release(); await navigation
    expect(p.refresh).toHaveBeenCalledTimes(5); expect(p.selectedRecipe.value).toEqual({ id: 7,marker: 'fresh' })
    p.event(false); p.event(true); await new Promise<void>(resolve => setImmediate(resolve)); expect(p.sync).toHaveBeenCalledOnce()
    p.location.pathname = '/profiles'; p.after(to)
    p.event(false); p.event(true); await new Promise<void>(resolve => setImmediate(resolve)); expect(p.sync).toHaveBeenCalledOnce()
    p.close(); expect(p.removeGuard).toHaveBeenCalledOnce(); expect(p.removeAfter).toHaveBeenCalledOnce()
  })
  it.each(['settings','form','trust'])('does not sync when blocked by %s', async reason => {
    const p = plugin(); p.options.onStart = true
    if (reason === 'settings') p.location.pathname = '/settings'
    if (reason === 'form') p.document.querySelector.mockReturnValue({})
    if (reason === 'trust') p.options.eligible = false
    await p.mount(); p.event(false); p.event(true)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(p.sync).not.toHaveBeenCalled(); p.close()
  })
})
