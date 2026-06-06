<script setup lang="ts">
// 全站顶栏：汉堡（开合侧栏）+ logo + 居中搜索 + 主题/新建/用户菜单。
defineProps<{ showMenuButton?: boolean }>()
const emit = defineEmits<{ toggleSidebar: [] }>()

const route = useRoute()
const router = useRouter()
const { toggle: toggleTheme } = useTheme()

// 搜索框与 /search?q= 双向同步（直达搜索页时回填关键词）
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(() => route.query.q, (q) => {
  keyword.value = typeof q === 'string' ? q : ''
})

function submitSearch() {
  const q = keyword.value.trim()
  if (q)
    router.push({ path: '/search', query: { q } })
}
</script>

<template>
  <header class="app-header">
    <div class="h-left">
      <button v-if="showMenuButton" class="icon-btn" type="button" title="菜单" @click="emit('toggleSidebar')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <NuxtLink to="/" class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="13" width="4" height="8" rx="1.2" fill="currentColor" opacity="0.55" />
            <rect x="10" y="8" width="4" height="13" rx="1.2" fill="currentColor" opacity="0.8" />
            <rect x="17" y="3" width="4" height="18" rx="1.2" fill="currentColor" />
          </svg>
        </span>
        <span class="brand-name">AniChart</span>
      </NuxtLink>
    </div>

    <form class="h-search" role="search" @submit.prevent="submitSearch">
      <input
        v-model="keyword" class="h-search-input" type="search"
        placeholder="搜索作品" aria-label="搜索作品"
      >
      <button class="h-search-btn" type="submit" title="搜索">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
      </button>
    </form>

    <div class="h-right">
      <button class="icon-btn theme-toggle" type="button" title="切换明暗主题" @click="toggleTheme">
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
      <NuxtLink to="/editor" class="btn btn-sm create-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        创建
      </NuxtLink>
      <UserMenu />
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky; top: 0; z-index: 50;
  height: var(--header-h);
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 0 16px;
  background: var(--header-bg);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border-bottom: 1px solid var(--border);
}

.h-left { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.brand { display: inline-flex; align-items: center; gap: 9px; padding: 4px 6px; }
.brand-mark { display: inline-flex; color: var(--text); }
.brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }

.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: none; border-radius: var(--r-sm);
  background: transparent; color: var(--text-2); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }

/* 居中搜索（YouTube 式） */
.h-search {
  flex: 1; max-width: 480px; display: flex; align-items: stretch;
  height: 36px;
}
.h-search-input {
  flex: 1; min-width: 0; padding: 0 14px;
  font-family: inherit; font-size: 14px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border-strong);
  border-right: none; border-radius: 999px 0 0 999px;
  transition: border-color 0.15s ease;
}
.h-search-input:focus { outline: none; border-color: var(--accent); }
.h-search-input::placeholder { color: var(--text-3); }
.h-search-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 52px; border: 1px solid var(--border-strong); border-radius: 0 999px 999px 0;
  background: var(--surface-2); color: var(--text-2); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.h-search-btn:hover { background: var(--surface-3); color: var(--text); }

.h-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.create-btn { border-radius: 999px; }

/* 亮色显示月亮（点击进入暗色），暗色显示太阳 */
.theme-toggle .icon-sun { display: none; }
:root[data-theme='dark'] .theme-toggle .icon-sun { display: block; }
:root[data-theme='dark'] .theme-toggle .icon-moon { display: none; }

@media (max-width: 640px) {
  .app-header { gap: 8px; padding: 0 10px; }
  .brand-name { display: none; }
  .create-btn span { display: none; }
}
</style>
