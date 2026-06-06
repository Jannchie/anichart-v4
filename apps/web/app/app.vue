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

const route = useRoute()

// 三态 chrome：
//   editor —— 全屏沉浸（无侧栏），编辑器自带工具栏
//   watch  —— 顶栏 + 无侧栏，把宽度留给播放器
//   app    —— 顶栏 + 左侧导航（feed / 频道 / 搜索 / 工作室）
const chrome = computed<'editor' | 'watch' | 'app'>(() => {
  if (route.path.startsWith('/editor'))
    return 'editor'
  if (route.path.startsWith('/watch') || route.path.startsWith('/w/') || route.path.startsWith('/login'))
    return 'watch'
  return 'app'
})

// 桌面端侧栏常驻；<900px 抽屉（CSS 切换），open 状态只在抽屉模式下有意义
const sidebarOpen = ref(false)
watch(() => route.fullPath, () => { sidebarOpen.value = false })
</script>

<template>
  <div class="app">
    <AppHeader :show-menu-button="chrome === 'app'" @toggle-sidebar="sidebarOpen = !sidebarOpen" />

    <div class="shell" :class="`shell--${chrome}`">
      <AppSidebar v-if="chrome === 'app'" :open="sidebarOpen" @close="sidebarOpen = false" />
      <main class="site-main">
        <NuxtPage />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }

.shell { flex: 1; display: flex; align-items: stretch; }
.site-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
