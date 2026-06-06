<script setup lang="ts">
import type { WorksPage } from '~/lib/works-api'
import { posterUrl } from '~/lib/format'

// 首页 feed：公开作品网格（YouTube 式）。
// client-only fetch：SSR 期不连 DB，无后端环境也能渲染壳。
const { data, pending, error } = useFetch<WorksPage>('/api/works', {
  server: false,
  query: { limit: 24 },
})

const items = ref<WorksPage['items']>([])
const nextCursor = ref<string | null>(null)
watch(data, (d) => {
  if (d) {
    items.value = d.items
    nextCursor.value = d.nextCursor
  }
}, { immediate: true })

const loadingMore = ref(false)
async function loadMore() {
  if (!nextCursor.value || loadingMore.value)
    return
  loadingMore.value = true
  try {
    const page = await $fetch<WorksPage>('/api/works', { query: { limit: 24, cursor: nextCursor.value } })
    items.value.push(...page.items)
    nextCursor.value = page.nextCursor
  }
  finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="feed">
    <!-- 轻量引导条：保留一句产品定位，不挤占 feed -->
    <div class="promo">
      <p class="promo-text">
        把表格变成会动的故事 —— 上传 CSV，几分钟做出可分享的动态图表。
      </p>
      <NuxtLink to="/editor" class="btn btn-primary btn-sm">
        开始创作
      </NuxtLink>
    </div>

    <!-- 加载骨架 -->
    <div v-if="pending" class="grid">
      <div v-for="i in 8" :key="i" class="sk-card">
        <div class="skeleton sk-thumb" />
        <div class="skeleton sk-line" />
        <div class="skeleton sk-line short" />
      </div>
    </div>

    <!-- 错误（后端未起也落到这里） -->
    <div v-else-if="error" class="empty card">
      <strong>加载失败</strong>
      <p class="dim">拿不到作品列表，请确认服务端在运行后刷新重试。</p>
    </div>

    <!-- feed 网格 -->
    <div v-else-if="items.length" class="grid">
      <WorkCard
        v-for="w in items" :key="w.id"
        :to="`/watch/${w.slug}`"
        :title="w.title"
        :poster="posterUrl(w.posterKey, w.updatedAt)"
        :kind="w.kind"
        :author-name="w.author.name"
        :author-id="w.author.id"
        :views="w.views"
        :date="w.createdAt"
      />
    </div>

    <!-- 空态 -->
    <div v-else class="empty card">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" />
        </svg>
      </div>
      <strong>还没有公开作品</strong>
      <p class="dim">成为第一个发布动态图表的人。</p>
      <NuxtLink to="/editor" class="btn btn-primary">
        开始创作
      </NuxtLink>
    </div>

    <div v-if="nextCursor" class="more">
      <button class="btn" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.feed { padding: 20px 24px 48px; max-width: 1600px; width: 100%; margin: 0 auto; }

.promo {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 16px; margin-bottom: 20px;
  border: 1px solid var(--border); border-radius: var(--r);
  background: var(--surface);
}
.promo-text { font-size: 13.5px; color: var(--text-2); }

.grid {
  display: grid; gap: 20px 16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.sk-card { display: flex; flex-direction: column; gap: 8px; }
.sk-thumb { aspect-ratio: 16 / 9; border-radius: var(--r); }
.sk-line { height: 13px; border-radius: 4px; width: 85%; }
.sk-line.short { width: 50%; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 56px 24px; text-align: center;
}
.empty-icon {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); background: var(--surface-2); margin-bottom: 4px;
}
.empty p { max-width: 36ch; margin-bottom: 8px; }

.more { display: flex; justify-content: center; margin-top: 28px; }

@media (max-width: 640px) {
  .feed { padding: 12px 12px 40px; }
  .grid { grid-template-columns: 1fr; gap: 18px; }
  .promo { flex-direction: column; align-items: flex-start; }
}
</style>
