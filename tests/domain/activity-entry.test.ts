import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { describe, it, expect, vi } from 'vitest'
import * as activities from '../../shared/domain/activities'
import * as validation from '../../shared/domain/validation'

function mount(profileId?: number) {
  const a = { id: 7, revision: 11, name: 'Walk', durationMinutes: 20, calories: 100, createdAt: '2026-10-08T10:00:00Z', updatedAt: null }
  const createActivityLogs = vi.fn(async (_input: activities.ActivityLogInput) => []), refreshActivities = vi.fn(async () => {}), refreshProfiles = vi.fn(async () => {})
  const source = readFileSync(new URL('../../app/components/ActivityEntry.client.vue', import.meta.url),'utf8')
  const compiled = compileScript(parse(source).descriptor,{ id: 'activity-entry-test', genDefaultAs: 'Entry' }).content
  const output = transpileModule(compiled+'\nexports.Entry = Entry;',{ compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}, imports: Record<string, unknown> = { vue: Vue, '../../shared/domain/activities': activities, '../../shared/domain/validation': validation }
  new Script(output).runInNewContext({ ...Vue, exports, require: (name: string) => { if (!(name in imports)) throw Error('Unexpected dependency'); return imports[name] }, useI18n: () => ({ t: (key: string) => key }), useActivities: () => ({ activities: Vue.ref([a]), refreshActivities, createActivityLogs }), useProfiles: () => ({ profiles: Vue.ref([{ id: 1, name: 'A' },{ id: 2, name: 'B' }]), refreshProfiles }) })
  exports.Entry.render = () => Vue.h('entry')
  const renderer = Vue.createRenderer<any, any>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, insert: () => {}, remove: () => {}, patchProp: () => {} })
  const app = renderer.createApp(exports.Entry,profileId === undefined ? {} : { profileId }); app.mount({})
  return { app, state: app._instance!.setupState, a, createActivityLogs }
}
describe('real activity entry component profile assignment', () => {
  it.each([undefined,1])('supports all profiles only when no profile was selected (%s)', async (profileId) => {
    const m = mount(profileId)
    try {
      await Vue.nextTick(); m.state.choose(m.a); m.state.units[1] = 1.5; m.state.units[2] = 0.5
      expect(m.createActivityLogs).not.toHaveBeenCalled()
      expect(m.state.visibleProfiles.map((p: any) => p.id)).toEqual(profileId === undefined ? [1,2] : [1])
      m.state.date = '2026-10-08'; await m.state.submit()
      expect(m.createActivityLogs).toHaveBeenCalledOnce()
      expect(m.createActivityLogs.mock.calls[0]![0]).toMatchObject({ activityId: 7, activityRevision: 11, date: '2026-10-08', profiles: profileId === undefined ? [{ profileId: 1, units: 1.5 },{ profileId: 2, units: 0.5 }] : [{ profileId: 1, units: 1.5 }] })
      expect(m.state.units[1]).toBe(0)
    } finally { m.app.unmount() }
  })
  it('does not fall back to other profiles when the selected profile is missing', async () => {
    const m = mount(999)
    try { expect(m.state.visibleProfiles).toEqual([]); expect(m.state.hasUnits).toBe(false) } finally { m.app.unmount() }
  })
})
