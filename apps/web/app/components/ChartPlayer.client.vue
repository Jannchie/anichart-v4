<script setup lang="ts">
import type { ConfigOptions } from '@anichart/core'
import { BarChart, Config, DataProcessor } from '@anichart/core'
import { Application } from 'pixi.js'

// 在浏览器里用 @anichart/core 实时播放：拉取数据 → 逐帧 update。
// 这是 SaaS「在线可播放作品」的核心运行时（仅客户端，避免 SSR 引入 WebGL）。
const props = defineProps<{
  dataUrl: string
  config: Partial<ConfigOptions>
}>()

const wrap = ref<HTMLDivElement>()
let app: Application | undefined

onMounted(async () => {
  if (!wrap.value)
    return
  app = new Application()
  await app.init({ background: '#ffffff', resizeTo: wrap.value })
  wrap.value.appendChild(app.canvas as HTMLCanvasElement)

  const config = new Config(props.config)
  const data = await DataProcessor.processCSV(props.dataUrl, config)
  const chart = new BarChart(data, config)
  app.stage.addChild(chart)

  let frame = 0
  app.ticker.add(() => {
    chart.update(frame)
    frame = (frame + 1) % data.length
  })
})

onBeforeUnmount(() => app?.destroy(true))
</script>

<template>
  <div ref="wrap" class="player" />
</template>

<style scoped>
.player { width: 100%; aspect-ratio: 16 / 9; background: #fff; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
</style>
