<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('settings.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('settings.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('settings.description') }}
        </p>
      </div>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <NuxtLink to="/profiles" class="flex min-h-14 items-center justify-between rounded-2xl bg-slate-50 px-4 transition active:scale-[0.99] dark:bg-slate-950">
        <span class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-2xl bg-munchling-50 text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500">
            <Icon name="ph:users-duotone" class="size-6" />
          </span>
          <span>
            <span class="block font-semibold">{{ $t('settings.profiles.title') }}</span>
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ $t('settings.profiles.hint') }}</span>
          </span>
        </span>
        <Icon name="ph:caret-right" class="size-5 text-slate-400" />
      </NuxtLink>
    </section>


    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center gap-3">
        <div class="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Icon name="ph:moon-stars-duotone" class="size-6" />
        </div>
        <div>
          <h2 class="font-semibold">{{ $t('settings.theme.title') }}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ $t('settings.theme.hint') }}</p>
        </div>
      </div>
      <p class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {{ $t('settings.theme.system') }}
      </p>
    </section>
    <AppBottomNav />
  </main>
</template>
