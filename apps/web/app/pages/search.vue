<script setup lang="ts">
import type { WorksPage } from '~/lib/works-api'
import { posterUrl } from '~/lib/format'

const route = useRoute()
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))

useHead({ title: () => (q.value ? `${q.value} — 搜索 — AniChart` : '探索 — AniChart') })

// q 响应式传入，路由变化自动重查；无关键词时退化为「探索」（最新公开作品）
const { data, pending } = useFetch<WorksPage>('/api/works', {
  server: false,
  query: computed(() => ({ q: q.value || undefined, limit: 30 })),
})
</script>

<template>
  <div class="search-page">
    <h1 class="sp-title">
      {{ q ? `“${q}” 的搜索结果` : '探索' }}
    </h1>

    <div v-if="pending" class="sp-list">
      <div v-for="i in 5" :key="i" class="sk-row">
        <div class="skeleton sk-thumb" />
        <div class="sk-lines">
          <div class="skeleton sk-line" />
          <div class="skeleton sk-line short" />
        </div>
      </div>
    </div>

    <div v-else-if="data?.items.length" class="sp-list">
      <WorkCard
        v-for="w in data.items" :key="w.id"
        compact
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

    <div v-else class="empty card">
      <strong>{{ q ? '没有匹配的作品' : '还没有公开作品' }}</strong>
      <p class="dim">
        {{ q ? '换个关键词试试。' : '成为第一个发布动态图表的人。' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.search-page { padding: 24px; max-width: 1000px; width: 100%; margin: 0 auto; }
.sp-title { font-size: 18px; margin-bottom: 20px; }

.sp-list { display: flex; flex-direction: column; gap: 16px; }
.sp-list :deep(.wc.compact .wc-thumb) { width: 246px; }

.sk-row { display: flex; gap: 12px; }
.sk-thumb { width: 246px; aspect-ratio: 16 / 9; border-radius: var(--r-sm); flex-shrink: 0; }
.sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.sk-line { height: 14px; border-radius: 4px; width: 70%; }
.sk-line.short { width: 40%; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 24px; text-align: center;
}

@media (max-width: 640px) {
  .search-page { padding: 16px 12px 40px; }
  .sp-list :deep(.wc.compact .wc-thumb) { width: 150px; }
  .sk-thumb { width: 150px; }
}
</style>
