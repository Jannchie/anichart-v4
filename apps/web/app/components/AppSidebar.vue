<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

// 左侧导航（YouTube 式）。<900px 由 app.vue 切换为抽屉模式。
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const session = authClient.useSession()
const me = computed(() => session.value?.data?.user ?? null)
</script>

<template>
  <!-- 移动端抽屉遮罩 -->
  <Transition name="fade">
    <div v-if="open" class="sidebar-mask" @click="emit('close')" />
  </Transition>

  <aside class="app-sidebar" :class="{ open }">
    <nav class="side-nav">
      <NuxtLink to="/" class="side-item" exact-active-class="active" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
        </svg>
        首页
      </NuxtLink>
      <NuxtLink to="/search" class="side-item" active-class="active" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        探索
      </NuxtLink>

      <div class="side-sep" />

      <NuxtLink v-if="me" :to="`/u/${me.id}`" class="side-item" active-class="active" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
        </svg>
        我的频道
      </NuxtLink>
      <NuxtLink to="/studio" class="side-item" active-class="active" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
        </svg>
        工作室
      </NuxtLink>
      <NuxtLink to="/editor" class="side-item" active-class="active" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建作品
      </NuxtLink>
    </nav>

    <p class="side-foot dim">
      AniChart · 让数据动起来
    </p>
  </aside>
</template>

<style scoped>
.app-sidebar {
  position: sticky; top: var(--header-h);
  width: 220px; height: calc(100vh - var(--header-h));
  flex-shrink: 0; overflow-y: auto;
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 12px; border-right: 1px solid var(--border);
  background: var(--bg);
}

.side-nav { display: flex; flex-direction: column; gap: 2px; }
.side-item {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 12px; border-radius: var(--r-sm);
  font-size: 14px; font-weight: 500; color: var(--text-2);
  transition: background 0.12s ease, color 0.12s ease;
}
.side-item:hover { background: var(--surface-2); color: var(--text); }
.side-item.active { background: var(--surface-2); color: var(--text); font-weight: 600; }
.side-item svg { flex-shrink: 0; }

.side-sep { height: 1px; margin: 8px 4px; background: var(--border); }
.side-foot { font-size: 12px; padding: 8px 12px; }

.sidebar-mask { display: none; }

@media (max-width: 900px) {
  /* 抽屉模式：固定在左侧滑出 */
  .app-sidebar {
    position: fixed; left: 0; top: var(--header-h); z-index: 55;
    transform: translateX(-100%); transition: transform 0.2s ease;
    box-shadow: var(--shadow-lg);
  }
  .app-sidebar.open { transform: translateX(0); }
  .sidebar-mask {
    display: block; position: fixed; inset: 0; top: var(--header-h); z-index: 54;
    background: rgba(0, 0, 0, 0.4);
  }
}
</style>
