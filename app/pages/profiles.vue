<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-32 pt-6">
    <header class="space-y-4">
      <NuxtLink to="/" class="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Icon name="ph:arrow-left" class="size-5" />
        {{ $t('common.back') }}
      </NuxtLink>

      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-munchling-600 dark:text-munchling-500">
          {{ $t('profiles.eyebrow') }}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('profiles.title') }}
        </h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('profiles.description') }}
        </p>
      </div>
    </header>

    <section class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ isEditing ? $t('profiles.form.editTitle') : $t('profiles.form.createTitle') }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('profiles.form.hint') }}
          </p>
        </div>
        <button
          v-if="isEditing"
          type="button"
          class="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 dark:text-slate-300"
          @click="resetForm"
        >
          {{ $t('common.cancel') }}
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="submitForm">
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('profiles.fields.name') }}</span>
          <input
            v-model="form.name"
            required
            class="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950"
            :placeholder="$t('profiles.placeholders.name')"
          >
        </label>

        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ $t('profiles.fields.calories') }}</span>
          <input
            v-model.number="form.dailyCaloriesTarget"
            required
            min="0"
            inputmode="numeric"
            type="number"
            class="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950"
          >
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label v-for="field in nutrientFields" :key="field.key" class="block space-y-1.5">
            <span class="text-sm font-medium">{{ $t(field.label) }}</span>
            <input
              v-model.number="form[field.key]"
              min="0"
              step="0.1"
              inputmode="decimal"
              type="number"
              class="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none transition focus:border-munchling-600 focus:ring-4 focus:ring-munchling-600/10 dark:border-slate-700 dark:bg-slate-950"
            >
          </label>
        </div>

        <button
          type="submit"
          class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-munchling-600 px-4 font-semibold text-white shadow-lg shadow-munchling-600/20 transition active:scale-[0.98] disabled:opacity-60"
          :disabled="isSaving"
        >
          <Icon :name="isEditing ? 'ph:check-circle-duotone' : 'ph:plus-circle-duotone'" class="size-5" />
          {{ isEditing ? $t('profiles.actions.save') : $t('profiles.actions.create') }}
        </button>
      </form>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">
          {{ $t('profiles.listTitle') }}
        </h2>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {{ profiles.length }}
        </span>
      </div>

      <div v-if="isLoading" class="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="profiles.length === 0" class="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        {{ $t('profiles.empty') }}
      </div>

      <article
        v-for="profile in profiles"
        v-else
        :key="profile.id"
        class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-semibold">{{ profile.name }}</h3>
              <span v-if="profile.id === currentProfileId" class="rounded-full bg-munchling-50 px-2 py-0.5 text-xs font-semibold text-munchling-700 dark:bg-munchling-600/15 dark:text-munchling-500">
                {{ $t('profiles.current') }}
              </span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400">
              {{ profile.dailyCaloriesTarget }} kcal · {{ macroSummary(profile) }}
            </p>
          </div>
          <button
            type="button"
            class="min-h-11 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            @click="selectProfile(profile.id)"
          >
            {{ $t('profiles.actions.select') }}
          </button>
        </div>

        <dl class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div v-for="target in targetSummary(profile)" :key="target.label" class="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <dt class="text-slate-500 dark:text-slate-400">{{ $t(target.label) }}</dt>
            <dd class="mt-1 font-semibold">{{ target.value }}</dd>
          </div>
        </dl>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="min-h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            @click="editProfile(profile)"
          >
            {{ $t('common.edit') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"
            @click="removeProfile(profile)"
          >
            {{ $t('common.delete') }}
          </button>
        </div>
      </article>
    </section>
    <AppBottomNav />
  </main>
</template>

<script setup lang="ts">
import { useCurrentProfile } from '~/composables/useCurrentProfile'
import { useProfiles } from '~/composables/useProfiles'
import type { Profile } from '~/utils/database/repositories'

type ProfileForm = {
  name: string
  dailyCaloriesTarget: number
  dailyProteinTarget: number | null
  dailyCarbsTarget: number | null
  dailyFatTarget: number | null
  dailySugarTarget: number | null
  dailyFiberTarget: number | null
  dailySaltTarget: number | null
}

type NutrientKey = Exclude<keyof ProfileForm, 'name' | 'dailyCaloriesTarget'>

const { t } = useI18n()
const { profiles, isLoading, refreshProfiles, createProfile, updateProfile, deleteProfile } = useProfiles()
const { currentProfileId, selectProfile, initializeCurrentProfile } = useCurrentProfile()

const isSaving = ref(false)
const editingProfileId = ref<number | null>(null)
const isEditing = computed(() => editingProfileId.value !== null)

const emptyForm = (): ProfileForm => ({
  name: '',
  dailyCaloriesTarget: 2200,
  dailyProteinTarget: null,
  dailyCarbsTarget: null,
  dailyFatTarget: null,
  dailySugarTarget: null,
  dailyFiberTarget: null,
  dailySaltTarget: null
})

const form = reactive<ProfileForm>(emptyForm())

const nutrientFields: Array<{ key: NutrientKey; label: string }> = [
  { key: 'dailyProteinTarget', label: 'profiles.fields.protein' },
  { key: 'dailyCarbsTarget', label: 'profiles.fields.carbs' },
  { key: 'dailyFatTarget', label: 'profiles.fields.fat' },
  { key: 'dailySugarTarget', label: 'profiles.fields.sugar' },
  { key: 'dailyFiberTarget', label: 'profiles.fields.fiber' },
  { key: 'dailySaltTarget', label: 'profiles.fields.salt' }
]

function nullableNumber(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resetForm() {
  Object.assign(form, emptyForm())
  editingProfileId.value = null
}

function editProfile(profile: Profile) {
  editingProfileId.value = profile.id
  Object.assign(form, {
    name: profile.name,
    dailyCaloriesTarget: profile.dailyCaloriesTarget,
    dailyProteinTarget: profile.dailyProteinTarget,
    dailyCarbsTarget: profile.dailyCarbsTarget,
    dailyFatTarget: profile.dailyFatTarget,
    dailySugarTarget: profile.dailySugarTarget,
    dailyFiberTarget: profile.dailyFiberTarget,
    dailySaltTarget: profile.dailySaltTarget
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function submitForm() {
  isSaving.value = true

  try {
    const input = {
      name: form.name,
      dailyCaloriesTarget: form.dailyCaloriesTarget,
      dailyProteinTarget: nullableNumber(form.dailyProteinTarget),
      dailyCarbsTarget: nullableNumber(form.dailyCarbsTarget),
      dailyFatTarget: nullableNumber(form.dailyFatTarget),
      dailySugarTarget: nullableNumber(form.dailySugarTarget),
      dailyFiberTarget: nullableNumber(form.dailyFiberTarget),
      dailySaltTarget: nullableNumber(form.dailySaltTarget)
    }

    if (editingProfileId.value) {
      await updateProfile(editingProfileId.value, input)
    } else {
      const profile = await createProfile(input)

      if (profile) {
        selectProfile(profile.id)
      }
    }

    resetForm()
  } finally {
    isSaving.value = false
  }
}

async function removeProfile(profile: Profile) {
  if (!confirm(t('profiles.confirmDelete', { name: profile.name }))) {
    return
  }

  await deleteProfile(profile.id)
}

function formatTarget(value: number | null, suffix = 'g') {
  return value === null ? '—' : `${value}${suffix}`
}

function macroSummary(profile: Profile) {
  return [
    formatTarget(profile.dailyProteinTarget),
    formatTarget(profile.dailyCarbsTarget),
    formatTarget(profile.dailyFatTarget)
  ].join(' / ')
}

function targetSummary(profile: Profile) {
  return [
    { label: 'profiles.fields.protein', value: formatTarget(profile.dailyProteinTarget) },
    { label: 'profiles.fields.carbs', value: formatTarget(profile.dailyCarbsTarget) },
    { label: 'profiles.fields.fat', value: formatTarget(profile.dailyFatTarget) },
    { label: 'profiles.fields.sugar', value: formatTarget(profile.dailySugarTarget) },
    { label: 'profiles.fields.fiber', value: formatTarget(profile.dailyFiberTarget) },
    { label: 'profiles.fields.salt', value: formatTarget(profile.dailySaltTarget) }
  ]
}

onMounted(async () => {
  await refreshProfiles()
  await initializeCurrentProfile()
})
</script>
