<script setup lang="ts">
useHead({
  title: 'AniChart — 让数据动起来',
  meta: [
    { name: 'description', content: '上传数据、配置图表、在线播放与分享你的动态数据可视化作品。' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  ],
  htmlAttrs: { lang: 'zh-CN' },
})

const route = useRoute()
// 编辑页用全宽沉浸布局，其余页面走带最大宽度的常规容器。
const fullBleed = computed(() => route.path.startsWith('/editor'))
</script>

<template>
  <div class="app" :class="{ 'app--full': fullBleed }">
    <header class="site-header">
      <div class="header-inner">
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

        <nav class="nav">
          <NuxtLink to="/" class="nav-link">
            发现
          </NuxtLink>
          <NuxtLink to="/editor" class="nav-link nav-cta">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            新建作品
          </NuxtLink>
        </nav>
      </div>
    </header>

    <main class="site-main">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }

.site-header {
  position: sticky; top: 0; z-index: 50;
  height: var(--header-h);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border-bottom: 1px solid var(--border);
}
.header-inner {
  height: 100%;
  max-width: 1120px; margin: 0 auto; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
}
.app--full .header-inner { max-width: none; padding: 0 20px; }

.brand { display: inline-flex; align-items: center; gap: 9px; }
.brand-mark { display: inline-flex; color: var(--accent); }
.brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }

.nav { display: flex; align-items: center; gap: 6px; }
.nav-link {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px;
  font-size: 14px; font-weight: 550; color: var(--text-2);
  border-radius: var(--r-sm);
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-link:hover { background: var(--surface-2); color: var(--text); }
.nav-link.router-link-exact-active:not(.nav-cta) { color: var(--text); }

.nav-cta {
  color: var(--accent-contrast); background: var(--accent);
  box-shadow: var(--shadow-sm);
}
.nav-cta:hover { background: var(--accent-hover); color: var(--accent-contrast); }

.site-main { flex: 1; display: flex; flex-direction: column; }
</style>
