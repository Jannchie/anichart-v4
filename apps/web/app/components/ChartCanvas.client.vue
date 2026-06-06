<script setup lang="ts">
import type { RankedData } from '@anichart/core'
import type { DSVRowArray } from 'd3'
import type { ChartSpec } from '~/lib/chart-spec'
import { BarChart, Config, DataProcessor, LineChart } from '@anichart/core'
import { Application } from 'pixi.js'
import { buildConfig, parseCsv } from '~/lib/chart-spec'

// 复用 @anichart/core 在浏览器里逐帧实时播放。编辑页预览与详情页播放共用这一个组件。
const props = withDefaults(defineProps<{
  csvText: string
  spec: ChartSpec
  controls?: boolean
  autoplay?: boolean
}>(), { controls: true, autoplay: true })

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const

const wrap = ref<HTMLDivElement>()
const error = ref('')
const ready = ref(false)

const isPaused = ref(false)
const currentFrame = ref(0)
const totalFrames = ref(0)
const speed = ref(1)

let app: Application | undefined
let chart: BarChart | LineChart | undefined
let rawRows: DSVRowArray<string> | null = null
let data: RankedData[][] = []
let rafId: number | undefined
let lastTime = 0
let accumulator = 0
let resumeAfterScrub = false
let rebuildToken: number | undefined

const progressPct = computed(() => totalFrames.value > 0 ? (currentFrame.value / totalFrames.value) * 100 : 0)

function fmtTime(frame: number) {
  const sec = Math.max(0, frame) / (props.spec.fps || 60)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function measure() {
  const r = wrap.value?.getBoundingClientRect()
  return { w: Math.max(1, Math.floor(r?.width ?? 960)), h: Math.max(1, Math.floor(r?.height ?? 540)) }
}

function makeConfig(w: number, h: number) {
  const cfg = new Config(buildConfig(props.spec))
  cfg.canvasWidth = w
  cfg.canvasHeight = h
  cfg.width = Math.max(w - 20, 0)
  cfg.height = Math.max(h - 20, 0)
  return cfg
}

function renderFrame(frame: number) {
  if (!chart || data.length === 0)
    return
  const safe = Math.min(Math.max(frame, 0), data.length - 1)
  chart.update(safe)
  currentFrame.value = safe
}

// 重建：可选地重新解析/处理数据，再按当前尺寸重建图表对象。
function build({ reprocess }: { reprocess: boolean }) {
  if (!app)
    return
  const token = (rebuildToken = (rebuildToken ?? 0) + 1)
  try {
    const { w, h } = measure()
    app.renderer.resize(w, h)
    const cfg = makeConfig(w, h)

    if (reprocess || data.length === 0) {
      rawRows ??= parseCsv(props.csvText)
      if (!rawRows.length)
        throw new Error('数据为空')
      data = DataProcessor.processRows(rawRows, cfg)
      totalFrames.value = Math.max(data.length - 1, 0)
    }

    if (chart) {
      chart.removeFromParent()
      chart.destroy({ children: true })
    }
    chart = props.spec.kind === 'line' ? new LineChart(data, cfg) : new BarChart(data, cfg)
    app.stage.addChild(chart)

    if (token !== rebuildToken)
      return
    error.value = ''
    renderFrame(Math.min(currentFrame.value, totalFrames.value))
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '渲染失败，请检查字段映射'
  }
}

function loop(now: number) {
  if (lastTime === 0)
    lastTime = now
  const dt = (now - lastTime) / 1000
  lastTime = now
  if (!isPaused.value && data.length > 0) {
    accumulator += dt * (props.spec.fps || 60) * speed.value
    const advance = Math.floor(accumulator)
    if (advance > 0) {
      accumulator -= advance
      let next = currentFrame.value + advance
      if (next >= data.length)
        next %= data.length
      renderFrame(next)
    }
  }
  rafId = requestAnimationFrame(loop)
}

function setPaused(p: boolean) {
  isPaused.value = p
  if (!p) {
    accumulator = 0
    lastTime = performance.now()
  }
}
function toggle() { setPaused(!isPaused.value) }
function stepBy(d: number) {
  setPaused(true)
  renderFrame(currentFrame.value + d)
}
function onScrubStart() {
  if (!isPaused.value) {
    resumeAfterScrub = true
    setPaused(true)
  }
}
function onScrubEnd() {
  if (resumeAfterScrub) {
    resumeAfterScrub = false
    setPaused(false)
  }
}
function onScrub(e: Event) {
  renderFrame(Number((e.target as HTMLInputElement).value) || 0)
}
function cycleSpeed() {
  const i = SPEED_OPTIONS.indexOf(speed.value as typeof SPEED_OPTIONS[number])
  speed.value = SPEED_OPTIONS[(i + 1) % SPEED_OPTIONS.length] ?? 1
}

// 截当前帧为 dataURL，供画廊封面用。
async function captureThumbnail(): Promise<string | undefined> {
  if (!app || data.length === 0)
    return undefined
  try {
    return await app.renderer.extract.base64(app.stage)
  }
  catch {
    return undefined
  }
}
defineExpose({ captureThumbnail })

let ro: ResizeObserver | undefined
onMounted(async () => {
  if (!wrap.value)
    return
  app = new Application()
  const { w, h } = measure()
  await app.init({ background: props.spec.backgroundColor, antialias: true, resolution: Math.min(globalThis.devicePixelRatio || 1, 2), autoDensity: true })
  app.renderer.resize(w, h)
  const canvas = app.canvas as HTMLCanvasElement
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  wrap.value.append(canvas)

  build({ reprocess: true })
  ready.value = true
  setPaused(!props.autoplay)
  lastTime = 0
  rafId = requestAnimationFrame(loop)

  ro = new ResizeObserver(() => build({ reprocess: false }))
  ro.observe(wrap.value)
})

// 数据变化 → 重新解析处理；spec 变化 → 重新处理（topN/时长/动画都依赖它）。合并到一帧避免拖动卡顿。
let pending: number | undefined
function scheduleRebuild(reprocess: boolean) {
  if (pending !== undefined)
    return
  pending = requestAnimationFrame(() => {
    pending = undefined
    build({ reprocess })
  })
}
watch(() => props.csvText, () => { rawRows = null; scheduleRebuild(true) })
watch(() => props.spec, () => scheduleRebuild(true), { deep: true })
watch(() => props.spec.backgroundColor, (c) => {
  if (app)
    app.renderer.background.color = c
})

onBeforeUnmount(() => {
  if (rafId !== undefined)
    cancelAnimationFrame(rafId)
  ro?.disconnect()
  app?.destroy(true)
})
</script>

<template>
  <div class="canvas-shell">
    <div ref="wrap" class="canvas-wrap" :style="{ background: spec.backgroundColor }" />

    <div v-if="error" class="overlay error">
      <div class="error-card">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
        <span>{{ error }}</span>
      </div>
    </div>
    <div v-else-if="!ready" class="overlay">
      <span class="spinner" aria-hidden="true" />
      <span class="loading-text">加载预览…</span>
    </div>

    <div v-if="controls && ready && !error" class="controls">
      <button class="ico" :title="isPaused ? '播放' : '暂停'" @click="toggle">
        <svg v-if="isPaused" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 4.5v15a1 1 0 0 0 1.54.84l11.5-7.5a1 1 0 0 0 0-1.68L8.54 3.66A1 1 0 0 0 7 4.5z" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="5.5" y="4" width="4.5" height="16" rx="1.4" /><rect x="14" y="4" width="4.5" height="16" rx="1.4" />
        </svg>
      </button>
      <button class="ico" title="后退一帧" @click="stepBy(-1)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.8 5.3a1 1 0 0 0-1.6-.8l-8 6.7a1 1 0 0 0 0 1.6l8 6.7a1 1 0 0 0 1.6-.8z" opacity="0.9" /><rect x="5" y="5" width="2.4" height="14" rx="1" />
        </svg>
      </button>
      <button class="ico" title="前进一帧" @click="stepBy(1)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6.2 5.3a1 1 0 0 1 1.6-.8l8 6.7a1 1 0 0 1 0 1.6l-8 6.7a1 1 0 0 1-1.6-.8z" opacity="0.9" /><rect x="16.6" y="5" width="2.4" height="14" rx="1" />
        </svg>
      </button>
      <input
        class="bar" type="range" min="0" :max="totalFrames" :value="currentFrame"
        :style="{ '--range-progress': `${progressPct}%` }"
        @pointerdown="onScrubStart" @pointerup="onScrubEnd" @pointercancel="onScrubEnd" @input="onScrub"
      >
      <span class="time">{{ fmtTime(currentFrame) }} / {{ fmtTime(totalFrames) }}</span>
      <button class="ico speed" title="播放速率" @click="cycleSpeed">
        {{ speed }}x
      </button>
    </div>
  </div>
</template>

<style scoped>
.canvas-shell { position: relative; width: 100%; height: 100%; }
.canvas-wrap { position: absolute; inset: 0; overflow: hidden; }

.overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center;
  font-size: 13px; pointer-events: none;
}
.loading-text { color: rgba(255, 255, 255, 0.5); }
.spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.7);
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-card {
  display: flex; align-items: center; gap: 9px;
  max-width: min(420px, 86%); padding: 12px 16px;
  background: rgba(20, 20, 24, 0.78); color: #fca5a5;
  border: 1px solid rgba(252, 165, 165, 0.25); border-radius: 12px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.error-card svg { flex-shrink: 0; }

.controls {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px;
  max-width: calc(100% - 24px);
  padding: 6px 8px;
  background: rgba(20, 20, 24, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 13px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  color: #f4f5f6;
  user-select: none;
}
.controls .ico {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 32px; height: 30px; padding: 0 8px;
  background: transparent; border: none; border-radius: 8px;
  color: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  transition: background 0.15s ease, transform 0.08s ease;
}
.controls .ico:hover { background: rgba(255, 255, 255, 0.1); }
.controls .ico:active { transform: scale(0.9); }
.controls .speed { font-variant-numeric: tabular-nums; min-width: 38px; font-size: 12.5px; }

.controls .time {
  min-width: 92px; text-align: center;
  font-size: 12px; font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.82);
}

.controls .bar {
  -webkit-appearance: none; appearance: none;
  width: 200px; max-width: 32vw; height: 30px; margin: 0 4px; background: transparent; cursor: pointer;
}
.controls .bar::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px;
  background: linear-gradient(to right,
    #5b8cff 0%, #5b8cff var(--range-progress, 0%),
    rgba(255, 255, 255, 0.18) var(--range-progress, 0%), rgba(255, 255, 255, 0.18) 100%);
}
.controls .bar::-moz-range-track { height: 4px; border-radius: 999px; background: rgba(255, 255, 255, 0.18); }
.controls .bar::-webkit-slider-thumb {
  -webkit-appearance: none; width: 13px; height: 13px; margin-top: -4.5px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.controls .bar::-moz-range-thumb { width: 13px; height: 13px; border: none; border-radius: 50%; background: #fff; }

@media (max-width: 560px) {
  /* 小屏控制条：收掉时间读数，把空间留给进度条 */
  .controls { bottom: 10px; gap: 2px; padding: 5px 6px; }
  .controls .time { display: none; }
  .controls .bar { width: 150px; max-width: 38vw; }
}
</style>
