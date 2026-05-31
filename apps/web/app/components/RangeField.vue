<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
  suffix?: string
  format?: (v: number) => string
}>(), { step: 1, suffix: '' })

const emit = defineEmits<{ 'update:modelValue': [number] }>()

const fill = computed(() => {
  const pct = ((props.modelValue - props.min) / (props.max - props.min)) * 100
  return `${Math.min(100, Math.max(0, pct))}%`
})

const display = computed(() => props.format ? props.format(props.modelValue) : `${props.modelValue}${props.suffix}`)

function onInput(e: Event) {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="range-field">
    <div class="range-top">
      <span class="field-label">{{ label }}</span>
      <span class="range-val">{{ display }}</span>
    </div>
    <input
      class="range" type="range" :min="min" :max="max" :step="step" :value="modelValue"
      :style="{ '--range-fill': fill }" @input="onInput"
    >
  </div>
</template>

<style scoped>
.range-field { display: flex; flex-direction: column; gap: 7px; }
.range-top { display: flex; align-items: baseline; justify-content: space-between; }
.range-val { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
</style>
