import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import * as Vue from 'vue'
import { describe, it, expect, vi } from 'vitest'
import * as routeHelpers from '../../app/utils/activity-entry-route'
import * as validation from '../../shared/domain/validation'

function mount(query: unknown, failed = false) {
  const route = Vue.reactive({ query: { profile: query } }), profiles = Vue.ref<Array<{ id: number, name: string }>>([])
  const refreshProfiles = vi.fn(async () => { if (failed) throw new Error('read failed'); profiles.value = [{ id: 1,name: 'A' },{ id: 2,name: 'B' }] })
  const source = readFileSync(new URL('../../app/pages/activity-log.vue',import.meta.url),'utf8')
  const compiled = compileScript(parse(source).descriptor,{ id: 'activity-route-test',genDefaultAs: 'Page' }).content
  const output = transpileModule(compiled+'\nexports.Page = Page;', { compilerOptions: { module: ModuleKind.CommonJS,target: ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}, imports: Record<string, unknown> = { vue: Vue,'../utils/activity-entry-route': routeHelpers,'../../shared/domain/validation': validation }
  new Script(output).runInNewContext({ ...Vue,exports,require: (name: string) => { if (!(name in imports)) throw new Error('Unexpected dependency'); return imports[name] },useRoute: () => route,useI18n: () => ({ t: (key: string) => key }),useProfiles: () => ({ profiles,refreshProfiles }) })
  exports.Page.render = () => Vue.h('page')
  const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}),createText: () => ({}),createComment: () => ({}),setText: () => {},setElementText: () => {},parentNode: () => null,nextSibling: () => null,insert: () => {},remove: () => {},patchProp: () => {} })
  const app = renderer.createApp(exports.Page); app.mount({})
  return { app,route,state: app._instance!.setupState,refreshProfiles }
}

describe('activity entry route', () => {
  it.each([null,'','0','01','-1','1.5','1x','1e2','9007199254740992',['1'],['1','2'],1])('rejects malformed profile %j without household fallback', value => {
    expect(routeHelpers.activityProfileFromQuery(value)).toBeNull()
  })
  it('allows household entry only for absent query and parses strict numeric IDs', () => {
    expect(routeHelpers.activityProfileFromQuery(undefined)).toBeUndefined()
    expect(routeHelpers.activityProfileFromQuery('2')).toBe(2)
  })
  it.each([undefined,'1','999','bad',['1','2']])('validates selected profile after loading (%j)', async query => {
    const m = mount(query)
    try {
      expect(m.state.ready).toBe(false); await new Promise<void>(resolve => setImmediate(resolve)); await Vue.nextTick()
      expect(m.refreshProfiles).toHaveBeenCalledOnce(); expect(m.state.ready).toBe(true)
      expect(m.state.validProfile).toBe(query === undefined || query === '1')
      expect(m.state.backTo).toBe(query === '1' ? '/dashboard/1' : '/')
      m.route.query.profile = '2'; await Vue.nextTick()
      expect(m.state.selectedProfileId).toBe(2); expect(m.state.backTo).toBe('/dashboard/2')
    } finally { m.app.unmount() }
  })
  it('does not expose a form on a failed profile read', async () => {
    const m = mount('1',true)
    try { await new Promise<void>(resolve => setImmediate(resolve)); await Vue.nextTick(); expect(m.state.ready).toBe(false); expect(m.state.loadError).toBeTruthy() }
    finally { m.app.unmount() }
  })
  it.each(['index','dashboard/[id]'])('dashboard %s links instead of mounting the entry and loads its own activity bonus', page => {
    const source = readFileSync(new URL(`../../app/pages/${page}.vue`,import.meta.url),'utf8')
    expect(source).not.toContain('<ActivityEntry')
    expect(source).toContain('/activity-log')
    expect(source).toContain('Promise.all([refreshProfiles(), refreshActivities()])')
  })
})
