<script setup lang="ts">
useHead({
  title: 'AniChart — 让数据动起来',
  meta: [
    { name: 'description', content: '上传数据、配置图表、在线播放与分享你的动态数据可视化作品。' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  ],
  htmlAttrs: { lang: 'zh-CN' },
  // 在首帧渲染前写入 data-theme，避免暗色用户看到白屏闪烁。
  script: [{ innerHTML: THEME_INIT_SCRIPT, tagPosition: 'head' }],
})

const { toggle: toggleTheme } = useTheme()

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
          <button class="nav-link theme-toggle" type="button" title="切换明暗主题" @click="toggleTheme">
            <!-- 两个图标都渲染，由 CSS 按 data-theme 显示其一，避免 hydration 不一致 -->
            <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
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

    <footer v-if="!fullBleed" class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="13" width="4" height="8" rx="1.2" fill="currentColor" opacity="0.55" />
              <rect x="10" y="8" width="4" height="13" rx="1.2" fill="currentColor" opacity="0.8" />
              <rect x="17" y="3" width="4" height="18" rx="1.2" fill="currentColor" />
            </svg>
          </span>
          <span>AniChart · 让数据动起来</span>
        </div>
        <nav class="footer-nav">
          <NuxtLink to="/" class="footer-link">
            发现
          </NuxtLink>
          <NuxtLink to="/editor" class="footer-link">
            编辑器
          </NuxtLink>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }

.site-header {
  position: sticky; top: 0; z-index: 50;
  height: var(--header-h);
  background: var(--header-bg);
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

.theme-toggle {
  width: 34px; padding: 0; justify-content: center;
  border: none; background: transparent; cursor: pointer; font: inherit;
}
.theme-toggle svg { flex-shrink: 0; }
/* 亮色显示月亮（点击进入暗色），暗色显示太阳 */
.theme-toggle .icon-sun { display: none; }
:root[data-theme='dark'] .theme-toggle .icon-sun { display: block; }
:root[data-theme='dark'] .theme-toggle .icon-moon { display: none; }

.site-main { flex: 1; display: flex; flex-direction: column; }

.site-footer {
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.footer-inner {
  max-width: 1120px; margin: 0 auto; padding: 20px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.footer-brand {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-3);
}
.footer-brand .brand-mark { color: var(--text-3); }
.footer-nav { display: flex; gap: 18px; }
.footer-link { font-size: 13px; color: var(--text-3); transition: color 0.15s ease; }
.footer-link:hover { color: var(--text); }

@media (max-width: 640px) {
  .header-inner { padding: 0 16px; }
  .footer-inner { padding: 16px; }
}
</style>
