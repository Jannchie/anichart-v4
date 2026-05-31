<script setup lang="ts">
import type { WorkRecord } from '~/lib/store'
import { deleteWork, getWorkBySlug } from '~/lib/store'

const route = useRoute()
const slug = route.params.slug as string

const work = ref<WorkRecord | null>(null)
const loading = ref(true)
const copied = ref(false)

onMounted(async () => {
  try {
    work.value = (await getWorkBySlug(slug)) ?? null
  }
  finally {
    loading.value = false
  }
})

const fields = computed(() => {
  if (!work.value)
    return []
  const s = work.value.spec
  return [
    { k: '类型', v: s.kind === 'line' ? '折线趋势' : '条形竞赛' },
    { k: '数据规模', v: `${work.value.rowCount} 行 · ${work.value.columns.length} 列` },
    { k: '名次', v: `Top ${s.topN}` },
    { k: '时长', v: `${s.totalDurationSec} 秒 · ${s.fps}fps` },
  ]
})

function fmtDate(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(globalThis.location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  }
  catch { /* 剪贴板不可用时静默 */ }
}

async function remove() {
  if (!work.value || !globalThis.confirm('确定删除这个作品？此操作不可撤销。'))
    return
  await deleteWork(work.value.id)
  await navigateTo('/')
}
</script>

<template>
  <div class="container detail">
    <!-- 加载骨架 -->
    <div v-if="loading" class="player-card card">
      <div class="player skeleton" />
    </div>

    <!-- 未找到 -->
    <div v-else-if="!work" class="notfound card">
      <strong>作品不存在</strong>
      <p class="dim">它可能保存在另一台设备的浏览器里，或已被删除。</p>
      <NuxtLink to="/" class="btn btn-primary">
        返回发现
      </NuxtLink>
    </div>

    <!-- 作品 -->
    <template v-else>
      <div class="player-card card" :style="{ background: work.spec.backgroundColor }">
        <ClientOnly>
          <ChartCanvas :csv-text="work.csvText" :spec="work.spec" />
        </ClientOnly>
      </div>

      <div class="info">
        <div class="info-head">
          <div>
            <h1 class="detail-title">
              {{ work.title }}
            </h1>
            <p class="dim detail-date">
              更新于 {{ fmtDate(work.updatedAt) }}
            </p>
          </div>
          <div class="actions">
            <button class="btn btn-sm" @click="copyLink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              {{ copied ? '已复制' : '复制链接' }}
            </button>
            <NuxtLink :to="`/editor?edit=${work.slug}`" class="btn btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              编辑
            </NuxtLink>
            <button class="btn btn-sm btn-danger" @click="remove">
              删除
            </button>
          </div>
        </div>

        <dl class="meta-grid">
          <div v-for="f in fields" :key="f.k" class="meta-item">
            <dt class="dim">
              {{ f.k }}
            </dt>
            <dd>{{ f.v }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail { padding: 28px 24px 56px; }

.player-card { overflow: hidden; aspect-ratio: 16 / 9; padding: 0; }
.player-card :deep(.canvas-shell) { width: 100%; height: 100%; }
.player { width: 100%; height: 100%; }

.info { margin-top: 22px; }
.info-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.detail-title { font-size: 26px; }
.detail-date { margin-top: 6px; font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.meta-grid {
  margin: 22px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1px;
  background: var(--border); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden;
}
.meta-item { background: var(--surface); padding: 14px 16px; }
.meta-item dt { font-size: 12px; margin-bottom: 4px; }
.meta-item dd { margin: 0; font-size: 14.5px; font-weight: 600; }

.notfound, .player-card.skeleton { }
.notfound {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 64px 24px; text-align: center;
}
.notfound p { max-width: 38ch; margin-bottom: 8px; }
</style>
