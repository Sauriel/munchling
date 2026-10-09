import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { navigationItems, isNavigationActive } from '../../app/utils/navigation'

const pages = ['index', 'dashboard/[id]', 'foods', 'recipes', 'log', 'activities', 'profiles', 'settings']
describe('single responsive shell and navigation', () => {
  it.each(pages)('keeps %s as one compilable main without a second navigation or a viewport-controlled form', (page) => {
    const filename = new URL(`../../app/pages/${page}.vue`, import.meta.url)
    const source = readFileSync(filename,'utf8'), { descriptor, errors } = parse(source)
    expect(errors).toEqual([])
    expect(compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id: page }).errors).toEqual([])
    expect(descriptor.template!.content.match(/<main\b/g)).toHaveLength(1)
    expect(descriptor.template!.content).toContain('id="main-content" tabindex="-1" class="page-shell"')
    expect(descriptor.template!.content).not.toMatch(/AppBottomNav|AppNavigation|max-w-md/)
    expect(descriptor.scriptSetup!.content).not.toMatch(/matchMedia|innerWidth|addEventListener\(['"]resize/)
  })
  it('mounts the navigation once above a stable page slot', () => {
    const app = readFileSync(new URL('../../app/app.vue',import.meta.url),'utf8')
    expect(app).toContain('<AppShell>'); expect(app).toContain('<WebWriteStatus'); expect(app).toContain('<NuxtPage />')
    const shell = readFileSync(new URL('../../app/components/AppShell.vue',import.meta.url),'utf8')
    expect(shell.match(/<AppNavigation\b/g)).toHaveLength(1)
    expect(shell.match(/<slot\b/g)).toHaveLength(1)
    expect(shell).toContain('href="#main-content"')
    const nav = readFileSync(new URL('../../app/components/AppNavigation.vue',import.meta.url),'utf8')
    expect(nav).toContain(':aria-current='); expect(nav).not.toMatch(/matchMedia|innerWidth|v-if/)
    expect(navigationItems.map(item => item.to)).toEqual(['/','/foods','/recipes','/activities','/settings'])
  })
  it.each([
    ['/', '/'], ['/log', '/'], ['/dashboard/7', '/'], ['/foods', '/foods'], ['/foods/7', '/foods'],
    ['/recipes', '/recipes'], ['/activities', '/activities'], ['/profiles', '/settings'], ['/settings', '/settings'],
  ])('selects exactly one navigation destination for %s', (path,destination) => {
    expect(navigationItems.filter(item => isNavigationActive(path,item.to)).map(item => item.to)).toEqual([destination])
  })
  it('does not mark unrelated route prefixes as active', () => {
    expect(isNavigationActive('/foods-other','/foods')).toBe(false)
    expect(isNavigationActive('/dashboard-other','/')).toBe(false)
  })
})
