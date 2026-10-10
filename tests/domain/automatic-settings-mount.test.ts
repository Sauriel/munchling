import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import * as Vue from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { SyncClientError } from '../../shared/domain/replies'

function mount(native = true) {
  const saved = { eligible: true,onStart: false,onResume: true }
  const read = vi.fn(async () => ({ ...saved })), configure = vi.fn(async (options: object) => { Object.assign(saved,options) })
  const clear = vi.fn(), imports: Record<string, unknown> = { vue: Vue,'@capacitor/core': { Capacitor: { isNativePlatform: () => native } },'~/utils/database/sql': { databaseSql: {} },'~/utils/sync/automatic-settings': { createAutomaticSyncSettings: () => ({ read,configure }) },'../../shared/domain/replies': { SyncClientError } }
  const source = readFileSync(new URL('../../app/components/AutomaticSyncSettings.client.vue',import.meta.url),'utf8')
  const compiled = compileScript(parse(source).descriptor,{ id: 'automatic-settings-test',genDefaultAs: 'Settings' }).content
  const output = transpileModule(compiled+'\nexports.Settings = Settings;',{ compilerOptions: { module: ModuleKind.CommonJS,target: ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  new Script(output).runInNewContext({ ...Vue,exports,require: (name: string) => { if (!(name in imports)) throw new Error('Unexpected dependency'); return imports[name] },setInterval: () => 1,clearInterval: clear })
  exports.Settings.render = () => Vue.h('settings')
  const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}),createText: () => ({}),createComment: () => ({}),setText: () => {},setElementText: () => {},parentNode: () => null,nextSibling: () => null,insert: () => {},remove: () => {},patchProp: () => {} })
  const app = renderer.createApp(exports.Settings); app.mount({})
  return { app,state: (app._instance as any).setupState,saved,read,configure,clear }
}
describe('automatic settings real mounted SFC', () => {
  it('loads without enabling anything, persists one switch without overwriting the other and clears the metadata timer', async () => {
    const m = mount()
    try {
      await vi.waitFor(() => expect(m.state.loading).toBe(false)); expect(m.configure).not.toHaveBeenCalled()
      await m.state.change('onStart',true); expect(m.configure).toHaveBeenCalledWith({ onStart: true,onResume: true })
      m.saved.eligible = false; m.saved.onStart = false; m.saved.onResume = false; await m.state.refresh()
      expect(m.state.options.eligible).toBe(false); expect(m.state.options.onStart).toBe(false)
    } finally { m.app.unmount() }
    expect(m.clear).toHaveBeenCalledOnce()
  })
  it('a concurrent metadata refresh cannot unlock a pending settings write', async () => {
    const m = mount()
    try {
      await vi.waitFor(() => expect(m.state.loading).toBe(false))
      let release!: (value: typeof m.saved) => void
      m.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      const pending = m.state.change('onStart',true)
      await m.state.refresh(); expect(m.state.saving).toBe(true)
      await m.state.change('onResume',false); expect(m.configure).not.toHaveBeenCalled()
      release({ ...m.saved }); await pending
      expect(m.configure).toHaveBeenCalledOnce(); expect(m.saved.onResume).toBe(true); expect(m.state.saving).toBe(false)
    } finally { m.app.unmount() }
  })
  it('performs no local database reads or writes in online web mode', async () => {
    const m = mount(false)
    try { await Vue.nextTick(); expect(m.read).not.toHaveBeenCalled(); expect(m.configure).not.toHaveBeenCalled() }
    finally { m.app.unmount() }
  })
})
