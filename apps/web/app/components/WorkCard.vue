<script setup lang="ts">
import { formatViews, timeAgo } from '~/lib/format'

// 作品卡：feed / 频道 / 搜索 / 工作室共用。
// 云端作品与本地草稿都归一成这组 props；compact 横向布局给观看页「接下来」用。
const props = withDefaults(defineProps<{
  to: string
  title: string
  poster?: string | null // 完整 URL 或 dataURL
  kind?: string
  authorName?: string
  authorId?: string
  views?: number
  date?: number | string | Date
  badge?: string // 额外徽标（如 私有/草稿）
  compact?: boolean
}>(), { poster: null })

const meta = computed(() => {
  const parts: string[] = []
  if (props.views !== undefined)
    parts.push(`${formatViews(props.views)} 次观看`)
  if (props.date)
    parts.push(timeAgo(props.date))
  return parts.join(' · ')
})

// 卡片本身是 <a>，作者名不能再嵌 <a>，用 click 跳转
const router = useRouter()
function goAuthor(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (props.authorId)
    router.push(`/u/${props.authorId}`)
}
</script>

<template>
  <NuxtLink :to="to" class="wc" :class="{ compact }">
    <div class="wc-thumb">
      <img v-if="poster" :src="poster" :alt="title" loading="lazy">
      <div v-else class="wc-fallback">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" opacity="0.45" />
          <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
          <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
        </svg>
      </div>
      <span v-if="kind" class="wc-kind badge">{{ kind === 'line' ? '折线' : '条形' }}</span>
      <span v-if="badge" class="wc-extra badge">{{ badge }}</span>
    </div>
    <div class="wc-meta">
      <strong class="wc-title">{{ title }}</strong>
      <span
        v-if="authorName" class="wc-author" :class="{ link: authorId }"
        :role="authorId ? 'link' : undefined" @click="authorId && goAuthor($event)"
      >{{ authorName }}</span>
      <span v-if="meta" class="wc-sub dim">{{ meta }}</span>
    </div>
  </NuxtLink>
</template>

<style scoped>
.wc { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.wc-thumb {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: var(--r); background: #0f1115;
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.15s ease;
}
.wc:hover .wc-thumb { border-color: var(--border-strong); }
.wc-thumb img { width: 100%; height: 100%; object-fit: cover; }
.wc-fallback { color: rgba(255, 255, 255, 0.22); }
.wc-kind {
  position: absolute; bottom: 8px; right: 8px;
  background: rgba(10, 10, 10, 0.75); color: #e7e7ea;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.wc-extra {
  position: absolute; top: 8px; left: 8px;
  background: rgba(10, 10, 10, 0.75); color: #e7e7ea;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}

.wc-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wc-title {
  font-size: 14px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wc-author { font-size: 12.5px; color: var(--text-2); width: fit-content; }
.wc-author.link { cursor: pointer; }
.wc-author.link:hover { color: var(--text); }
.wc-sub { font-size: 12.5px; }

/* 横向紧凑卡（观看页右栏） */
.wc.compact { flex-direction: row; gap: 10px; }
.wc.compact .wc-thumb { width: 168px; flex-shrink: 0; border-radius: var(--r-sm); }
.wc.compact .wc-title { font-size: 13.5px; }
.wc.compact .wc-kind { display: none; }
</style>
