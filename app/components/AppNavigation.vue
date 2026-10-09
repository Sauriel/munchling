<template>
  <nav class="app-navigation border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-300" :aria-label="$t('nav.label')">
    <div class="app-navigation-inner">
      <NuxtLink to="/" aria-current-value="false" class="app-brand font-bold text-slate-950 dark:text-white" :aria-label="$t('nav.dashboard')">
        <img src="/munchling_768.png" alt="" class="size-9 shrink-0 rounded-xl">
        <span>{{ $t('app.name') }}</span>
      </NuxtLink>
      <div class="app-navigation-links">
        <NuxtLink v-for="item in navigationItems" :key="item.to" :to="item.to" class="app-navigation-link rounded-2xl font-medium transition active:scale-95" :aria-current="isNavigationActive(route.path, item.to) ? 'page' : undefined" :class="isNavigationActive(route.path, item.to) ? 'bg-munchling-50 text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800'">
          <Icon :name="item.icon" class="size-5 shrink-0" />
          <span>{{ $t(item.label) }}</span>
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { navigationItems, isNavigationActive } from '../utils/navigation'
const route = useRoute()
</script>
