<template>
  <AppShell>
    <WebWriteStatus v-if="useRuntimeConfig().public.dataMode === 'online'" />
    <NuxtPage />
  </AppShell>
</template>
