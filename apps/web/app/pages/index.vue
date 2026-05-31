<script setup lang="ts">
import type { WorkRecord } from '~/lib/store'
import { listWorks } from '~/lib/store'

const works = ref<WorkRecord[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    works.value = await listWorks()
  }
  finally {
    loading.value = false
  }
})

const templates = [
  { key: 'basic', title: '基础示例', desc: 'id · 日期 · 数值，最小可用的条形竞赛', accent: '#4f46e5' },
  { key: 'llm', title: 'LLM 天梯榜', desc: '按公司分色的大模型 Elo 排名变化', accent: '#0ea5e9' },
]

function fmtDate(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="hero">
      <div class="container hero-inner">
        <span class="badge badge-accent hero-badge">数据可视化 · 在线播放</span>
        <h1 class="hero-title">
          把表格，<br>变成会动的故事
        </h1>
        <p class="hero-sub">
          上传一份 CSV，映射字段、调好节奏，立刻得到一张可在线播放、可分享的动态排行榜。无需安装，浏览器里实时渲染。
        </p>
        <div class="hero-actions">
          <NuxtLink to="/editor" class="btn btn-primary btn-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            新建作品
          </NuxtLink>
          <NuxtLink to="/editor?sample=llm" class="btn btn-lg">
            体验示例
          </NuxtLink>
        </div>
      </div>
    </section>

    <div class="container">
      <!-- 快速开始模板 -->
      <section class="block">
        <div class="block-head">
          <h2>从模板开始</h2>
          <span class="dim">挑一个数据集，直接进编辑器调参</span>
        </div>
        <div class="tpl-grid">
          <NuxtLink
            v-for="t in templates" :key="t.key"
            :to="`/editor?sample=${t.key}`" class="card tpl"
          >
            <span class="tpl-thumb" :style="{ '--c': t.accent }">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.45" />
                <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
                <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
              </svg>
            </span>
            <div class="tpl-meta">
              <strong>{{ t.title }}</strong>
              <span class="dim">{{ t.desc }}</span>
            </div>
            <svg class="tpl-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </NuxtLink>
        </div>
      </section>

      <!-- 我的作品 -->
      <section class="block">
        <div class="block-head">
          <h2>我的作品</h2>
          <NuxtLink v-if="works.length" to="/editor" class="btn btn-sm">
            新建
          </NuxtLink>
        </div>

        <div v-if="loading" class="gallery">
          <div v-for="i in 3" :key="i" class="card work-card">
            <div class="work-thumb skeleton" />
            <div class="work-meta">
              <div class="skeleton" style="height: 14px; width: 60%; border-radius: 4px;" />
            </div>
          </div>
        </div>

        <div v-else-if="works.length" class="gallery">
          <NuxtLink
            v-for="w in works" :key="w.id"
            :to="`/w/${w.slug}`" class="card work-card"
          >
            <div class="work-thumb">
              <img v-if="w.thumbnail" :src="w.thumbnail" :alt="w.title">
              <div v-else class="work-thumb-fallback">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.45" />
                  <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
                  <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
                </svg>
              </div>
              <span class="work-kind badge">{{ w.spec.kind === 'line' ? '折线' : '条形' }}</span>
            </div>
            <div class="work-meta">
              <strong class="work-title">{{ w.title || '未命名作品' }}</strong>
              <span class="dim work-sub">{{ w.rowCount }} 行 · {{ fmtDate(w.updatedAt) }}</span>
            </div>
          </NuxtLink>
        </div>

        <div v-else class="empty card">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" />
            </svg>
          </div>
          <strong>还没有作品</strong>
          <p class="dim">上传一份数据，几分钟做出第一张动态图表。</p>
          <NuxtLink to="/editor" class="btn btn-primary">
            开始创作
          </NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hero { padding: 64px 0 40px; }
.hero-inner { display: flex; flex-direction: column; align-items: flex-start; }
.hero-badge { margin-bottom: 18px; }
.hero-title { font-size: clamp(34px, 6vw, 54px); line-height: 1.08; letter-spacing: -0.03em; }
.hero-sub { margin-top: 18px; max-width: 56ch; font-size: 16px; line-height: 1.65; color: var(--text-2); }
.hero-actions { margin-top: 28px; display: flex; gap: 12px; flex-wrap: wrap; }

.block { padding: 28px 0; }
.block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.block-head .dim { font-size: 13px; }

.tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.tpl {
  display: flex; align-items: center; gap: 14px; padding: 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
.tpl:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-1px); }
.tpl-thumb {
  flex-shrink: 0; width: 52px; height: 52px; border-radius: var(--r);
  display: flex; align-items: center; justify-content: center;
  color: var(--c); background: color-mix(in srgb, var(--c) 12%, white);
}
.tpl-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tpl-meta strong { font-size: 14.5px; }
.tpl-meta .dim { font-size: 12.5px; }
.tpl-arrow { margin-left: auto; color: var(--text-3); flex-shrink: 0; }

.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 16px; }
.work-card { overflow: hidden; transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease; }
.work-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.work-thumb {
  position: relative; aspect-ratio: 16 / 9; background: #0f1115;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.work-thumb img { width: 100%; height: 100%; object-fit: cover; }
.work-thumb-fallback { color: rgba(255, 255, 255, 0.25); }
.work-kind { position: absolute; top: 8px; left: 8px; background: rgba(20, 20, 24, 0.7); color: #e7e7ea; backdrop-filter: blur(8px); }
.work-meta { padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.work-title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work-sub { font-size: 12px; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 56px 24px; text-align: center;
}
.empty-icon {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); background: var(--accent-soft); margin-bottom: 4px;
}
.empty p { max-width: 36ch; margin-bottom: 8px; }
</style>
