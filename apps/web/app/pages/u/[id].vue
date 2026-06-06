<script setup lang="ts">
import type { WorksPage } from '~/lib/works-api'
import { posterUrl } from '~/lib/format'

interface Profile {
  id: string
  name: string
  image: string | null
  createdAt: string
  workCount: number
}

const route = useRoute()
const id = route.params.id as string

const { data: profile, pending, error } = useFetch<Profile>(`/api/users/${id}`, { server: false })
const { data: worksData, pending: worksPending } = useFetch<WorksPage>('/api/works', {
  server: false,
  query: { author: id, limit: 24 },
})

watch(profile, (p) => {
  if (p)
    useHead({ title: `${p.name} 的频道 — AniChart` })
})

const initial = computed(() => (profile.value?.name?.[0] ?? '?').toUpperCase())
function joinedYear(d: string) {
  return new Date(d).getFullYear()
}
</script>

<template>
  <div class="channel">
    <div v-if="pending" class="ch-head">
      <div class="skeleton ch-avatar" />
      <div class="ch-id">
        <div class="skeleton" style="height: 22px; width: 160px; border-radius: 4px;" />
      </div>
    </div>

    <div v-else-if="error || !profile" class="empty card">
      <strong>频道不存在</strong>
      <NuxtLink to="/" class="btn btn-primary">
        返回首页
      </NuxtLink>
    </div>

    <template v-else>
      <div class="ch-head">
        <span class="ch-avatar">
          <img v-if="profile.image" :src="profile.image" :alt="profile.name">
          <template v-else>{{ initial }}</template>
        </span>
        <div class="ch-id">
          <h1 class="ch-name">
            {{ profile.name }}
          </h1>
          <p class="dim ch-sub">
            {{ profile.workCount }} 个作品 · {{ joinedYear(profile.createdAt) }} 年加入
          </p>
        </div>
      </div>

      <div class="ch-sep" />

      <div v-if="worksPending" class="grid">
        <div v-for="i in 4" :key="i" class="sk-card">
          <div class="skeleton sk-thumb" />
          <div class="skeleton sk-line" />
        </div>
      </div>
      <div v-else-if="worksData?.items.length" class="grid">
        <WorkCard
          v-for="w in worksData.items" :key="w.id"
          :to="`/watch/${w.slug}`"
          :title="w.title"
          :poster="posterUrl(w.posterKey, w.updatedAt)"
          :kind="w.kind"
          :views="w.views"
          :date="w.createdAt"
        />
      </div>
      <div v-else class="empty card">
        <strong>还没有公开作品</strong>
      </div>
    </template>
  </div>
</template>

<style scoped>
.channel { padding: 28px 24px 48px; max-width: 1600px; width: 100%; margin: 0 auto; }

.ch-head { display: flex; align-items: center; gap: 20px; }
.ch-avatar {
  width: 80px; height: 80px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-2); border: 1px solid var(--border-strong);
  font-size: 30px; font-weight: 700; color: var(--text-2);
}
.ch-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ch-name { font-size: 24px; }
.ch-sub { margin-top: 4px; font-size: 13px; }

.ch-sep { height: 1px; background: var(--border); margin: 24px 0; }

.grid {
  display: grid; gap: 20px 16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.sk-card { display: flex; flex-direction: column; gap: 8px; }
.sk-thumb { aspect-ratio: 16 / 9; border-radius: var(--r); }
.sk-line { height: 13px; border-radius: 4px; width: 80%; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px 24px; text-align: center;
}

@media (max-width: 640px) {
  .channel { padding: 20px 12px 40px; }
  .ch-avatar { width: 60px; height: 60px; font-size: 24px; }
  .grid { grid-template-columns: 1fr; }
}
</style>
