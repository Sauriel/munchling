<template>
  <div class="app-shell">
    <a href="#main-content" class="skip-link rounded-xl bg-munchling-600 px-4 py-3 font-semibold text-white">{{ $t('common.skipToContent') }}</a>
    <AppNavigation />
    <div class="app-workspace"><slot /></div>
  </div>
</template>
