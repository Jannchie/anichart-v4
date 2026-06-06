<script setup lang="ts">
import type { ChartSpec } from '~/lib/chart-spec'
import type { ApiWorkDetail, WorksPage } from '~/lib/works-api'
import { authClient } from '~/lib/auth-client'
import { defaultSpec } from '~/lib/chart-spec'
import { formatViews, posterUrl, timeAgo } from '~/lib/format'

const route = useRoute()
const slug = route.params.slug as string

// 元信息 → CSV（代理回流）→ 播放。全程 client fetch（SSR 不连 DB）。
const { data: meta, pending, error } = useFetch<ApiWorkDetail>(`/api/works/${slug}`, { server: false })
const csvText = ref('')
const csvError = ref(false)

watch(meta, async (m) => {
  if (!m)
    return
  useHead({ title: `${m.title} — AniChart` })
  try {
    csvText.value = await $fetch<string>(`/api/works/${slug}/csv`, { responseType: 'text' })
  }
  catch {
    csvError.value = true
  }
}, { immediate: true })

// 可序列化 spec → 补全缺省字段后喂给播放器
const spec = computed<ChartSpec | null>(() =>
  meta.value ? { ...defaultSpec(), ...meta.value.chartConfig } : null,
)

// 播放计数：挂载时 fire-and-forget
onMounted(() => {
  $fetch(`/api/works/${slug}/view`, { method: 'POST' }).catch(() => {})
})

// 接下来：最新公开作品，排除当前
const { data: nextData } = useFetch<WorksPage>('/api/works', { server: false, query: { limit: 13 } })
const upNext = computed(() => (nextData.value?.items ?? []).filter(w => w.slug !== slug).slice(0, 12))

// 作者本人可见「编辑」入口
const session = authClient.useSession()
const isOwner = computed(() => !!meta.value?.author && session.value?.data?.user?.id === meta.value.author.id)

const copied = ref(false)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(globalThis.location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  }
  catch { /* 剪贴板不可用时静默 */ }
}

const authorInitial = computed(() => (meta.value?.author?.name?.[0] ?? '?').toUpperCase())
</script>

<template>
  <div class="watch">
    <div class="primary">
      <!-- 播放器 -->
      <div class="player" :style="spec ? { background: spec.backgroundColor } : undefined">
        <ClientOnly>
          <ChartCanvas v-if="spec && csvText" :csv-text="csvText" :spec="spec" />
          <div v-else-if="error || csvError" class="player-state">
            作品不存在或已被删除
          </div>
          <div v-else class="player-state">
            <span class="skeleton player-skeleton" />
          </div>
        </ClientOnly>
      </div>

      <!-- 信息区 -->
      <template v-if="meta">
        <h1 class="w-title">
          {{ meta.title }}
        </h1>
        <div class="w-meta dim">
          {{ formatViews(meta.views) }} 次观看 · {{ timeAgo(meta.createdAt) }}
          <span v-if="meta.visibility !== 'public'" class="badge">{{ meta.visibility === 'private' ? '私有' : '不公开' }}</span>
        </div>

        <div class="w-author-row">
          <NuxtLink v-if="meta.author" :to="`/u/${meta.author.id}`" class="w-author">
            <span class="w-avatar">
              <img v-if="meta.author.image" :src="meta.author.image" :alt="meta.author.name">
              <template v-else>{{ authorInitial }}</template>
            </span>
            <strong>{{ meta.author.name }}</strong>
          </NuxtLink>
          <div class="w-actions">
            <button class="btn btn-sm" @click="copyLink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              {{ copied ? '已复制' : '分享' }}
            </button>
            <NuxtLink v-if="isOwner" :to="`/editor?work=${meta.slug}`" class="btn btn-sm">
              编辑
            </NuxtLink>
          </div>
        </div>

        <p v-if="meta.description" class="w-desc card">
          {{ meta.description }}
        </p>
      </template>
    </div>

    <!-- 接下来 -->
    <aside v-if="upNext.length" class="rail">
      <h2 class="rail-title">
        接下来
      </h2>
      <div class="rail-list">
        <WorkCard
          v-for="w in upNext" :key="w.id"
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
    </aside>
  </div>
</template>

<style scoped>
.watch {
  display: flex; gap: 24px; align-items: flex-start;
  width: 100%; max-width: 1680px; margin: 0 auto;
  padding: 20px 24px 48px;
}
.primary { flex: 1; min-width: 0; }

.player {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: var(--r); background: #0f1115; border: 1px solid var(--border);
}
.player :deep(.canvas-shell) { position: absolute; inset: 0; }
.player-state {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.5); font-size: 13px;
}
.player-skeleton { position: absolute; inset: 0; opacity: 0.1; }

.w-title { margin-top: 14px; font-size: 19px; line-height: 1.35; }
.w-meta { margin-top: 6px; font-size: 13px; display: flex; align-items: center; gap: 8px; }

.w-author-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 14px; padding: 12px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.w-author { display: inline-flex; align-items: center; gap: 10px; }
.w-avatar {
  width: 38px; height: 38px; border-radius: 50%; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-2); border: 1px solid var(--border-strong);
  font-size: 15px; font-weight: 650; color: var(--text-2);
}
.w-avatar img { width: 100%; height: 100%; object-fit: cover; }
.w-actions { display: flex; gap: 8px; }

.w-desc { margin-top: 14px; padding: 14px 16px; font-size: 13.5px; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }

.rail { width: 380px; flex-shrink: 0; }
.rail-title { font-size: 15px; margin-bottom: 12px; }
.rail-list { display: flex; flex-direction: column; gap: 12px; }

@media (max-width: 1100px) {
  .watch { flex-direction: column; }
  .rail { width: 100%; }
}
@media (max-width: 640px) {
  .watch { padding: 0 0 40px; gap: 16px; }
  .player { border-radius: 0; border-left: none; border-right: none; }
  .w-title, .w-meta, .w-author-row, .w-desc { margin-left: 12px; margin-right: 12px; }
  .rail { padding: 0 12px; }
}
</style>
