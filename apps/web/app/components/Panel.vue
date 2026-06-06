<script setup lang="ts">
// 编辑器侧边栏的可折叠面板：标题行是开关，action 插槽放常驻操作（如「更换」）。
const props = withDefaults(defineProps<{
  title: string
  defaultOpen?: boolean
}>(), { defaultOpen: true })

const open = ref(props.defaultOpen)
</script>

<template>
  <div class="panel" :class="{ closed: !open }">
    <div class="panel-head">
      <button type="button" class="panel-toggle" :aria-expanded="open" @click="open = !open">
        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span class="panel-title">{{ title }}</span>
      </button>
      <slot name="action" />
    </div>
    <div class="panel-body">
      <div class="panel-clip">
        <div class="panel-content">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
  overflow: hidden;
}

.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 4px 8px 4px 0;
}
.panel-toggle {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 7px;
  padding: 9px 0 9px 12px; border: none; background: none; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--text-3); text-align: left;
  transition: color 0.15s ease;
}
.panel-toggle:hover { color: var(--text-2); }
.chev { flex-shrink: 0; transition: transform 0.18s ease; transform: rotate(90deg); }
.closed .chev { transform: rotate(0deg); }

/* grid 0fr 折叠：clip 层无 padding 才能收干净，padding 放最内层 */
.panel-body {
  display: grid; grid-template-rows: 1fr;
  transition: grid-template-rows 0.2s ease;
}
.closed .panel-body { grid-template-rows: 0fr; }
.panel-clip { overflow: hidden; min-height: 0; }
.panel-content {
  display: flex; flex-direction: column; gap: 12px;
  padding: 4px 14px 14px;
}
</style>
