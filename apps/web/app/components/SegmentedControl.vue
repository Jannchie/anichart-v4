<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  options: { label: string, value: T }[]
}>()
defineEmits<{ 'update:modelValue': [T] }>()
</script>

<template>
  <div class="segmented" role="tablist">
    <button
      v-for="opt in options" :key="opt.value"
      type="button" class="seg" :class="{ active: opt.value === modelValue }"
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex; gap: 2px; padding: 3px;
  background: var(--surface-2); border-radius: var(--r-sm);
  border: 1px solid var(--border);
}
.seg {
  flex: 1; height: 30px; padding: 0 10px;
  font-family: inherit; font-size: 13px; font-weight: 550; color: var(--text-2);
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  white-space: nowrap;
}
.seg:hover { color: var(--text); }
.seg.active { color: var(--text); background: var(--surface); box-shadow: var(--shadow-sm); }
</style>
