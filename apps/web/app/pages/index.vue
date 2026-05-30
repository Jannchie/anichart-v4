<script setup lang="ts">
// 公开作品 feed。后端未配置 DB 时此请求会失败，属预期（骨架阶段）。
const { data: works, error } = await useFetch('/api/works', { default: () => [] })
</script>

<template>
  <section>
    <h1>用数据讲故事</h1>
    <p class="lead">
      上传你的数据，配置一张会动的图表，分享一段在线播放的数据可视化作品。
    </p>

    <h2>最新作品</h2>
    <p v-if="error" class="hint">
      暂时取不到作品列表（后端/数据库尚未配置）。
    </p>
    <ul v-else-if="works?.length" class="grid">
      <li v-for="w in works" :key="w.id">
        <NuxtLink :to="`/w/${w.slug}`">
          {{ w.title }}
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="hint">
      还没有公开作品。
    </p>
  </section>
</template>

<style scoped>
.lead { color: #555; max-width: 60ch; }
.hint { color: #999; }
.grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.grid li { border: 1px solid #eee; border-radius: 8px; padding: 16px; }
</style>
