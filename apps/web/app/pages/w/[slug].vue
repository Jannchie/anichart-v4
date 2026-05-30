<script setup lang="ts">
import type { ConfigOptions } from '@anichart/core'

const route = useRoute()
const slug = route.params.slug as string

const { data: work, error } = await useFetch(`/api/works/${slug}`)

// TODO(future): 由 dataset 解析出可访问的数据 URL（公开 bucket 直链或预签名 GET）
const dataUrl = computed(() => work.value ? `/api/datasets/${(work.value as any).datasetId}/raw` : '')
const config = computed(() => (work.value?.chartConfig ?? {}) as Partial<ConfigOptions>)
</script>

<template>
  <section>
    <p v-if="error" class="hint">
      作品不存在或后端未就绪。
    </p>
    <template v-else-if="work">
      <h1>{{ work.title }}</h1>
      <!-- 客户端实时播放；数据接口就绪后即可工作 -->
      <ClientOnly>
        <ChartPlayer :data-url="dataUrl" :config="config" />
      </ClientOnly>
    </template>
  </section>
</template>

<style scoped>
.hint { color: #999; }
</style>
