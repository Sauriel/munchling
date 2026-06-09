<template>
  <nav class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-slate-200 bg-white/90 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
    <div class="grid grid-cols-4 gap-2">
      <NuxtLink
        v-for="item in items"
        :key="item.label"
        :to="item.to"
        class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium text-slate-600 transition active:scale-95 dark:text-slate-300"
        :class="isActive(item.to) ? 'bg-munchling-50 text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800'"
      >
        <Icon :name="item.icon" class="size-5" />
        <span>{{ $t(item.label) }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
const route = useRoute()

const items = [
  { label: 'nav.dashboard', icon: 'ph:gauge-duotone', to: '/' },
  { label: 'nav.foods', icon: 'ph:fork-knife-duotone', to: '/foods' },
  { label: 'nav.profiles', icon: 'ph:users-duotone', to: '/profiles' },
  { label: 'nav.settings', icon: 'ph:gear-six-duotone', to: '/settings' }
]

function isActive(to: string) {
  if (to === '/') {
    return route.path === '/' || route.path === '/log'
  }

  if (to === '/foods') {
    return route.path === '/foods' || route.path === '/recipes'
  }

  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>
