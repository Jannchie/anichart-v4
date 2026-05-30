<script setup lang="ts">
const file = ref<File | null>(null)
const status = ref('')

function onPick(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function upload() {
  if (!file.value)
    return
  status.value = '请求上传地址…'
  // 1) 取预签名 URL
  const { url, key } = await $fetch<{ url: string, key: string }>('/api/datasets/presign', {
    method: 'POST',
    body: { filename: file.value.name, contentType: file.value.type || 'text/csv' },
  })
  // 2) 直传对象存储
  status.value = '上传中…'
  await fetch(url, { method: 'PUT', body: file.value })
  // 3) TODO(future): 调用 /api/datasets 落库（解析列名/行数），再跳到图表配置页
  status.value = `已上传：${key}`
}
</script>

<template>
  <section>
    <h1>上传数据</h1>
    <p class="hint">
      支持 CSV。上传后将解析字段，进入图表配置（待实现）。
    </p>
    <input type="file" accept=".csv,text/csv" @change="onPick">
    <button :disabled="!file" @click="upload">
      上传
    </button>
    <p v-if="status">
      {{ status }}
    </p>
  </section>
</template>

<style scoped>
.hint { color: #777; }
button { margin-left: 12px; padding: 8px 16px; }
</style>
