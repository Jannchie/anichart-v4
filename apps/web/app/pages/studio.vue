<script setup lang="ts">
import type { WorkRecord } from '~/lib/store'
import type { WorksPage } from '~/lib/works-api'
import { authClient } from '~/lib/auth-client'
import { posterUrl, timeAgo } from '~/lib/format'
import { deleteWork as deleteDraft, listWorks } from '~/lib/store'

useHead({ title: '工作室 — AniChart' })

// 工作室：云端已发布（API）+ 本地草稿（IndexedDB）并列管理。
const session = authClient.useSession()
const loggedIn = computed(() => !!session.value?.data?.user)

// 云端作品：登录后才查（author=me 需要 session cookie）
const { data: cloudData, pending: cloudPending, refresh: refreshCloud } = useFetch<WorksPage>('/api/works', {
  server: false,
  query: { author: 'me', limit: 50 },
  immediate: false,
})
watch(loggedIn, (v) => {
  if (v)
    refreshCloud()
}, { immediate: true })

const cloud = computed(() => cloudData.value?.items ?? [])
const VISIBILITY_LABEL: Record<string, string> = { public: '公开', unlisted: '不公开', private: '私有' }

const deleting = ref<string | null>(null)
async function removeCloud(slug: string, title: string) {
  if (!globalThis.confirm(`确定删除已发布的「${title}」？此操作不可撤销。`))
    return
  deleting.value = slug
  try {
    await $fetch(`/api/works/${slug}`, { method: 'DELETE' })
    await refreshCloud()
  }
  finally {
    deleting.value = null
  }
}

// 本地草稿
const drafts = ref<WorkRecord[]>([])
const draftsLoading = ref(true)
onMounted(async () => {
  try {
    drafts.value = await listWorks()
  }
  finally {
    draftsLoading.value = false
  }
})
async function removeDraft(d: WorkRecord) {
  if (!globalThis.confirm(`确定删除草稿「${d.title}」？`))
    return
  await deleteDraft(d.id)
  drafts.value = drafts.value.filter(x => x.id !== d.id)
}
</script>

<template>
  <div class="studio">
    <h1 class="st-title">
      工作室
    </h1>

    <!-- 云端作品 -->
    <section class="st-block">
      <div class="st-head">
        <h2>已发布</h2>
        <span class="dim">{{ loggedIn ? `${cloud.length} 个作品` : '' }}</span>
      </div>

      <div v-if="!loggedIn" class="empty card">
        <strong>登录后管理你发布的作品</strong>
        <NuxtLink to="/login" class="btn btn-primary btn-sm">
          去登录
        </NuxtLink>
      </div>
      <div v-else-if="cloudPending" class="st-list">
        <div v-for="i in 2" :key="i" class="skeleton sk-row" />
      </div>
      <div v-else-if="cloud.length" class="st-list">
        <div v-for="w in cloud" :key="w.id" class="st-row card">
          <NuxtLink :to="`/watch/${w.slug}`" class="st-thumb">
            <img v-if="w.posterKey" :src="posterUrl(w.posterKey, w.updatedAt)!" :alt="w.title">
            <div v-else class="st-thumb-fallback">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.45" />
                <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
                <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
              </svg>
            </div>
          </NuxtLink>
          <div class="st-info">
            <NuxtLink :to="`/watch/${w.slug}`" class="st-name">
              {{ w.title }}
            </NuxtLink>
            <span class="dim st-sub">
              <span class="badge">{{ VISIBILITY_LABEL[w.visibility] }}</span>
              {{ w.views }} 次观看 · 更新于 {{ timeAgo(w.updatedAt) }}
            </span>
          </div>
          <div class="st-actions">
            <NuxtLink :to="`/editor?work=${w.slug}`" class="btn btn-sm">
              编辑
            </NuxtLink>
            <button class="btn btn-sm btn-danger" :disabled="deleting === w.slug" @click="removeCloud(w.slug, w.title)">
              {{ deleting === w.slug ? '删除中…' : '删除' }}
            </button>
          </div>
        </div>
      </div>
      <div v-else class="empty card">
        <strong>还没有发布过作品</strong>
        <p class="dim">在编辑器里点「发布」，作品就会出现在这里和首页 feed。</p>
        <NuxtLink to="/editor" class="btn btn-primary btn-sm">
          去创作
        </NuxtLink>
      </div>
    </section>

    <!-- 本地草稿 -->
    <section class="st-block">
      <div class="st-head">
        <h2>本地草稿</h2>
        <span class="dim">只保存在这台设备的浏览器里</span>
      </div>

      <div v-if="draftsLoading" class="st-list">
        <div class="skeleton sk-row" />
      </div>
      <div v-else-if="drafts.length" class="st-list">
        <div v-for="d in drafts" :key="d.id" class="st-row card">
          <NuxtLink :to="`/w/${d.slug}`" class="st-thumb">
            <img v-if="d.thumbnail" :src="d.thumbnail" :alt="d.title">
            <div v-else class="st-thumb-fallback">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.45" />
                <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
                <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
              </svg>
            </div>
          </NuxtLink>
          <div class="st-info">
            <NuxtLink :to="`/w/${d.slug}`" class="st-name">
              {{ d.title || '未命名草稿' }}
            </NuxtLink>
            <span class="dim st-sub">{{ d.rowCount }} 行 · 更新于 {{ timeAgo(d.updatedAt) }}</span>
          </div>
          <div class="st-actions">
            <NuxtLink :to="`/editor?edit=${d.slug}`" class="btn btn-sm">
              编辑
            </NuxtLink>
            <button class="btn btn-sm btn-danger" @click="removeDraft(d)">
              删除
            </button>
          </div>
        </div>
      </div>
      <div v-else class="empty card">
        <strong>没有本地草稿</strong>
        <p class="dim">编辑器里「存草稿」的作品会出现在这里。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.studio { padding: 28px 24px 48px; max-width: 1000px; width: 100%; margin: 0 auto; }
.st-title { font-size: 22px; margin-bottom: 8px; }

.st-block { margin-top: 24px; }
.st-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.st-head h2 { font-size: 16px; }
.st-head .dim { font-size: 12.5px; }

.st-list { display: flex; flex-direction: column; gap: 10px; }
.sk-row { height: 86px; border-radius: var(--r); }

.st-row { display: flex; align-items: center; gap: 14px; padding: 12px; }
.st-thumb {
  width: 120px; aspect-ratio: 16 / 9; flex-shrink: 0;
  border-radius: var(--r-sm); overflow: hidden; background: #0f1115;
  display: flex; align-items: center; justify-content: center;
}
.st-thumb img { width: 100%; height: 100%; object-fit: cover; }
.st-thumb-fallback { color: rgba(255, 255, 255, 0.22); }
.st-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.st-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-name:hover { text-decoration: underline; }
.st-sub { font-size: 12.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.st-actions { display: flex; gap: 8px; flex-shrink: 0; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 36px 20px; text-align: center;
}
.empty p { max-width: 40ch; }

@media (max-width: 640px) {
  .studio { padding: 20px 12px 40px; }
  .st-row { flex-wrap: wrap; }
  .st-thumb { width: 96px; }
  .st-actions { width: 100%; justify-content: flex-end; }
}
</style>
