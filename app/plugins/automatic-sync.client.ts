import { Capacitor } from '@capacitor/core'
import { createAutomaticSyncCoordinator, type AutomaticSyncTrigger } from '~/utils/sync/automatic'
import { createAutomaticSyncSettings } from '~/utils/sync/automatic-settings'
import { createManualSyncRunner } from '~/utils/sync/runner'
import { databaseSql } from '~/utils/database/sql'

export default defineNuxtPlugin({
  name: 'automatic-sync', dependsOn: ['munchling-data'],
  setup(nuxtApp) {
    if (!Capacitor.isNativePlatform() || useRuntimeConfig().public.dataMode !== 'local') return
    const settings = createAutomaticSyncSettings(databaseSql), runner = createManualSyncRunner(databaseSql)
    const status = useState('automatic-sync-status', () => ({ busy: false, error: '', completed: false }))
    const { refreshProfiles } = useProfiles(), { refreshFoods } = useFoods(), { refreshRecipes, selectedRecipe } = useRecipes(), { refreshMealLogs } = useMealLogs(), { refreshActivities } = useActivities()
    const { getRecipeWithIngredients } = useMunchlingData().recipes
    const navigating = new Set<unknown>()
    let flight: Promise<void> | null = null
    let event: AutomaticSyncTrigger = 'start', closed = false
    let remove: (() => Promise<void>) | undefined
    // Fail closed while a destination editor has not mounted its form yet.
    const quiet = () => (location.pathname === '/' || /^\/dashboard\/[1-9]\d*\/?$/.test(location.pathname)) && !document.querySelector('main form')
    async function permitted(trigger: AutomaticSyncTrigger) {
      if (closed || navigating.size || !quiet()) return false
      const options = await settings.read()
      return !closed && !navigating.size && quiet() && options.eligible && (trigger === 'start' ? options.onStart : options.onResume)
    }
    const coordinator = createAutomaticSyncCoordinator({
      permitted: async trigger => { event = trigger; return permitted(trigger) },
      run: async signal => {
        const work = (async () => {
          status.value = { busy: true,error: '',completed: false }
          try { await runner.sync(true,signal,() => permitted(event)); status.value.completed = !signal.aborted }
          finally {
            try {
              // Cancellation can arrive after an atomic receive committed. Refresh
              // before navigation is released, never underneath a mounted editor.
              if (!closed && quiet()) {
                await Promise.all([refreshProfiles(),refreshFoods(),refreshRecipes(),refreshMealLogs(),refreshActivities()])
                const selected = selectedRecipe.value
                if (selected) {
                  const fresh = await getRecipeWithIngredients(selected.id)
                  if (!closed && quiet() && selectedRecipe.value === selected && fresh) selectedRecipe.value = fresh
                }
              }
            } finally { status.value.busy = false }
          }
        })()
        flight = work
        try { await work } finally { if (flight === work) flight = null }
      },
      onError: code => { if (code !== 'syncBusy' && code !== 'confirmSync') status.value.error = code },
    })
    const router = useRouter()
    const removeGuard = router.beforeEach(async to => {
      navigating.add(to)
      const pending = flight
      coordinator.cancel()
      if (pending) await pending.catch(() => {})
    })
    const removeAfter = router.afterEach(to => { navigating.delete(to) })
    const cleanup = () => { closed = true; coordinator.close(); removeGuard(); removeAfter(); void remove?.().catch(() => {}) }
    nuxtApp.vueApp.onUnmount(cleanup)
    import.meta.hot?.dispose(cleanup)
    nuxtApp.hook('app:mounted', async () => {
      try {
        const { App } = await import('@capacitor/app')
        if (closed) return
        let events = 0
        const listener = await App.addListener('appStateChange', state => { events++; void coordinator.setActive(state.isActive) })
        remove = () => listener.remove()
        if (closed) { await listener.remove(); return }
        const initial = await App.getState()
        if (!events) await coordinator.setActive(initial.isActive)
        await coordinator.start()
      } catch { if (!closed) status.value.error = 'localOrNetworkError' }
    })
  },
})
