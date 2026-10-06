<template>
  <WebWriteStatus v-if="useRuntimeConfig().public.dataMode === 'online'" />
  <NuxtPage />
</template>
