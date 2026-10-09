export const navigationItems = [
  { label: 'nav.dashboard', icon: 'ph:gauge-duotone', to: '/' },
  { label: 'nav.foods', icon: 'ph:fork-knife-duotone', to: '/foods' },
  { label: 'nav.recipes', icon: 'ph:cooking-pot-duotone', to: '/recipes' },
  { label: 'nav.activities', icon: 'ph:person-simple-run-duotone', to: '/activities' },
  { label: 'nav.settings', icon: 'ph:gear-six-duotone', to: '/settings' },
] as const

export function isNavigationActive(path: string, destination: string) {
  if (destination === '/') return path === '/' || path === '/log' || path === '/activity-log' || path.startsWith('/dashboard/')
  if (destination === '/settings' && path === '/profiles') return true
  return path === destination || path.startsWith(`${destination}/`)
}
