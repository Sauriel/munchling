<template>
  <div class="min-w-0 space-y-1 text-xs">
    <p v-if="!value">{{ $t('settings.syncDecision.absent') }}</p>
    <p v-else-if="value.deleted_at || value.deletedAt">{{ $t('settings.syncDecision.deleted') }}</p>
    <template v-else>
      <p class="break-words font-semibold">{{ value.name ?? value.name_de ?? value.name_en ?? value.logged_at ?? value.id }}</p>
      <p v-if="value.ean">EAN: {{ value.ean }}</p>
      <p v-if="value.daily_calories_target != null">{{ value.daily_calories_target }} kcal</p>
      <p v-if="value.calories_per_100g != null">{{ value.calories_per_100g }} kcal / 100 g</p>
      <p v-if="value.total_weight_grams != null">{{ value.total_weight_grams }} g</p>
      <ul v-if="Array.isArray(value.ingredients)" class="space-y-1">
        <li v-for="(child, index) in value.ingredients" :key="index" class="break-all">{{ child.amount_grams }} g · {{ child.food_id ?? child.sub_recipe_id }}</li>
      </ul>
      <ul v-if="Array.isArray(value.profiles)" class="space-y-1">
        <li v-for="(child, index) in value.profiles" :key="index" class="break-all">{{ $t('settings.syncDecision.portion', { factor: child.portion_factor }) }} · {{ child.profile_id }}</li>
      </ul>
    </template>
    <details v-if="payload" class="pt-1"><summary>{{ $t('settings.syncDecision.fullFields') }}</summary><pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(payload, null, 2) }}</pre></details>
  </div>
</template>
<script setup lang="ts">
const props = defineProps<{ payload: unknown }>()
const value = computed<Record<string, unknown> | null>(() => {
  if (!props.payload || typeof props.payload !== 'object') return null
  const packet = props.payload as Record<string, unknown>
  return packet.data && typeof packet.data === 'object' ? packet.data as Record<string, unknown> : packet
})
</script>
