import type { Config, RankedData } from '@anichart/core'
import type { DSVRowArray } from 'd3'
import { BarChart, computeInversionMetrics, DataProcessor, LineChart } from '@anichart/core'
import { csv } from 'd3'
import { Application } from 'pixi.js'
import { DATASETS } from './datasets'
import './style.css'

const app = new Application()

// 当前数据集 / 配置：切换数据集时重建 config（字段映射、配色、文案随之改变）。
let activeDataset = DATASETS[0]
let config: Config = activeDataset.makeConfig()

type ChartInstance = BarChart | LineChart

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const

document.documentElement.style.height = '100%'
document.documentElement.style.margin = '0'
document.documentElement.style.padding = '0'

document.body.style.margin = '0'
document.body.style.height = '100vh'
document.body.style.width = '100vw'
document.body.style.backgroundColor = '#111111'
document.body.style.display = 'flex'
document.body.style.alignItems = 'stretch'
document.body.style.justifyContent = 'flex-start'
document.body.style.fontFamily = 'Berkeley Mono, monospace'
document.body.style.color = '#ffffff'

const root = document.createElement('div')
root.style.flex = '1'
root.style.position = 'relative'
root.style.width = '100%'
root.style.height = '100%'
root.style.overflow = 'hidden'
document.body.append(root)

const canvasContainer = document.createElement('div')
canvasContainer.style.position = 'relative'
canvasContainer.style.width = '100%'
canvasContainer.style.height = '100%'
canvasContainer.style.display = 'flex'
canvasContainer.style.alignItems = 'stretch'
canvasContainer.style.justifyContent = 'flex-start'
canvasContainer.style.backgroundColor = '#111111'
root.append(canvasContainer)

const controls = document.createElement('div')
controls.className = 'controls'
canvasContainer.append(controls)

function makeButton(label: string, title: string) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  return btn
}

function makeSelect() {
  return document.createElement('select')
}

function makeDivider() {
  const divider = document.createElement('span')
  divider.className = 'ctrl-divider'
  return divider
}

const datasetSelect = makeSelect()
for (const d of DATASETS) {
  datasetSelect.add(new Option(d.label, d.key))
}
datasetSelect.value = activeDataset.key
datasetSelect.title = '数据集'

const chartSelect = makeSelect()
chartSelect.add(new Option('Bar', 'bar'))
chartSelect.add(new Option('Line', 'line'))
chartSelect.value = 'bar'
chartSelect.title = '图表类型'

// 加速度强度 boost：0 即纯 velocity，越大暴涨柱越快收敛（软饱和封顶）。始终走 accel，强度全由 boost 控制。
const boostSlider = document.createElement('input')
boostSlider.type = 'range'
boostSlider.min = '0'
boostSlider.max = '3'
boostSlider.step = '0.1'
boostSlider.value = config.swapAccelBoost.toString()
boostSlider.title = '加速度强度 boost（0 = velocity）'
boostSlider.style.width = '90px'
const boostLabel = document.createElement('span')
boostLabel.className = 'ctrl-label ctrl-label--muted'
boostLabel.textContent = `boost ${config.swapAccelBoost.toFixed(1)}`
const metricsLabel = document.createElement('span')
metricsLabel.className = 'ctrl-label ctrl-label--muted'
metricsLabel.title = '逆序对×帧 / 惯性能量'

const timeAxisSelect = makeSelect()
timeAxisSelect.add(new Option('动态贴合', 'dynamic'))
timeAxisSelect.add(new Option('完整时间轴', 'fixed'))
timeAxisSelect.add(new Option('滚动时间窗', 'window'))
timeAxisSelect.value = config.lineTimeAxisMode
timeAxisSelect.title = '折线图时间轴模式'

const firstFrameBtn = makeButton('⏮', '跳到首帧 (Home)')
const prevFrameBtn = makeButton('◀', '后退一帧 (← / Shift+← 跳 10 帧)')
const toggleButton = makeButton('⏸', '暂停 / 继续 (Space)')
const nextFrameBtn = makeButton('▶', '前进一帧 (→ / Shift+→ 跳 10 帧)')
const lastFrameBtn = makeButton('⏭', '跳到末帧 (End)')

const progress = document.createElement('input')
progress.type = 'range'
progress.min = '0'
progress.max = '0'
progress.value = '0'
progress.step = '1'
progress.className = 'ctrl-progress'

const timeLabel = document.createElement('span')
timeLabel.textContent = '00:00 / 00:00'
timeLabel.className = 'ctrl-label'

const frameLabel = document.createElement('span')
frameLabel.textContent = 'f0 / f0'
frameLabel.className = 'ctrl-label ctrl-label--muted'
frameLabel.title = '当前帧 / 总帧数'

const speedSelect = makeSelect()
for (const s of SPEED_OPTIONS) {
  speedSelect.add(new Option(`${s}x`, s.toString()))
}
speedSelect.value = '1'
speedSelect.title = '播放速率 ([ / ])'

controls.append(
  datasetSelect,
  chartSelect,
  boostSlider,
  boostLabel,
  timeAxisSelect,
  makeDivider(),
  firstFrameBtn,
  prevFrameBtn,
  toggleButton,
  nextFrameBtn,
  lastFrameBtn,
  makeDivider(),
  progress,
  timeLabel,
  frameLabel,
  makeDivider(),
  speedSelect,
  makeDivider(),
  metricsLabel,
)

let data: RankedData[][] = []
let chart: ChartInstance | null = null
let animationFrameId: number | undefined
let isPaused = false
let currentFrame = 0
let resumeAfterScrub = false
let chartType: 'bar' | 'line' = 'bar'
let speed = 1
let frameAccumulator = 0
let lastLoopTime = 0

const clampSize = (value: number) => Math.max(1, Math.floor(value))

function getContainerSize() {
  const rect = canvasContainer.getBoundingClientRect()
  return {
    width: clampSize(rect.width),
    height: clampSize(rect.height),
  }
}

function applyConfigSize(width: number, height: number) {
  config.canvasWidth = width
  config.canvasHeight = height
  config.width = Math.max(width - 20, 0)
  config.height = Math.max(height - 20, 0)
}

function formatTime(frame: number, fps: number) {
  const totalSec = Math.max(0, frame) / fps
  const min = Math.floor(totalSec / 60)
  const sec = Math.floor(totalSec % 60)
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

function syncTimeLabel() {
  const fps = config.fps
  const total = Math.max(data.length - 1, 0)
  timeLabel.textContent = `${formatTime(currentFrame, fps)} / ${formatTime(total, fps)}`
  frameLabel.textContent = `f${currentFrame} / f${total}`
}

function syncButtonState() {
  toggleButton.textContent = isPaused ? '▶' : '⏸'
  toggleButton.title = isPaused ? '继续 (Space)' : '暂停 (Space)'
}

function setPauseState(paused: boolean) {
  isPaused = paused
  if (!paused) {
    // 切到播放时重置累积器，避免长时间暂停后一次性吃帧
    frameAccumulator = 0
    lastLoopTime = performance.now()
  }
  syncButtonState()
}

function updateProgressFill() {
  const max = Number(progress.max) || 0
  const value = Number(progress.value) || 0
  const pct = max > 0 ? (value / max) * 100 : 0
  progress.style.setProperty('--range-progress', `${pct}%`)
}

function renderFrame(frame: number) {
  if (!chart || data.length === 0) {
    return
  }
  const safeFrame = Math.min(Math.max(frame, 0), data.length - 1)
  chart.update(safeFrame)
  progress.value = safeFrame.toString()
  updateProgressFill()
  currentFrame = safeFrame
  syncTimeLabel()
}

function stepBy(delta: number) {
  if (data.length === 0) {
    return
  }
  setPauseState(true)
  const next = Math.min(Math.max(currentFrame + delta, 0), data.length - 1)
  renderFrame(next)
}

function syncTimeAxisSelectVisibility() {
  // 时间轴模式仅对折线图有意义
  timeAxisSelect.style.display = chartType === 'line' ? '' : 'none'
}

function rebuildChart() {
  if (data.length === 0) {
    return
  }
  syncTimeAxisSelectVisibility()
  if (chart) {
    chart.removeFromParent()
    chart.destroy({ children: true })
  }
  // 折线图显示分类标签，条形图不显示；标题 / 坐标轴文案由数据集 config 决定。
  config.showLabel = chartType === 'line'

  chart = chartType === 'line'
    ? new LineChart(data, config)
    : new BarChart(data, config)

  app.stage.addChild(chart)
  renderFrame(currentFrame)
}

function loop(now: number) {
  if (lastLoopTime === 0) {
    lastLoopTime = now
  }
  const dt = (now - lastLoopTime) / 1000
  lastLoopTime = now

  if (!isPaused && data.length > 0) {
    frameAccumulator += dt * config.fps * speed
    const framesToAdvance = Math.floor(frameAccumulator)
    if (framesToAdvance > 0) {
      frameAccumulator -= framesToAdvance
      let nextFrame = currentFrame + framesToAdvance
      if (nextFrame >= data.length) {
        nextFrame = nextFrame % data.length
      }
      renderFrame(nextFrame)
    }
  }
  animationFrameId = requestAnimationFrame(loop)
}

function adjustSpeed(direction: 1 | -1) {
  const currentIdx = (SPEED_OPTIONS as readonly number[]).indexOf(speed)
  const nextIdx = Math.min(SPEED_OPTIONS.length - 1, Math.max(0, currentIdx + direction))
  if (nextIdx !== currentIdx) {
    speed = SPEED_OPTIONS[nextIdx]
    speedSelect.value = speed.toString()
  }
}

toggleButton.addEventListener('click', () => {
  setPauseState(!isPaused)
})

firstFrameBtn.addEventListener('click', () => {
  setPauseState(true)
  renderFrame(0)
})

lastFrameBtn.addEventListener('click', () => {
  setPauseState(true)
  renderFrame(data.length - 1)
})

prevFrameBtn.addEventListener('click', () => stepBy(-1))
nextFrameBtn.addEventListener('click', () => stepBy(1))

speedSelect.addEventListener('change', () => {
  const next = Number(speedSelect.value)
  if (Number.isFinite(next) && next > 0) {
    speed = next
    frameAccumulator = 0
  }
})

progress.addEventListener('pointerdown', () => {
  if (!isPaused) {
    resumeAfterScrub = true
    setPauseState(true)
  }
})

function concludeScrub() {
  if (resumeAfterScrub) {
    resumeAfterScrub = false
    setPauseState(false)
  }
}

progress.addEventListener('pointerup', concludeScrub)
progress.addEventListener('pointercancel', concludeScrub)

progress.addEventListener('input', () => {
  if (data.length === 0) {
    return
  }
  const nextFrame = Number(progress.value) || 0
  renderFrame(nextFrame)
})

chartSelect.addEventListener('change', () => {
  const nextType = chartSelect.value === 'line' ? 'line' : 'bar'
  if (nextType === chartType && chart) {
    return
  }
  chartType = nextType
  currentFrame = 0
  progress.value = '0'
  rebuildChart()
})

datasetSelect.addEventListener('change', () => {
  const next = DATASETS.find(d => d.key === datasetSelect.value)
  if (!next || next.key === activeDataset.key) {
    return
  }
  loadDataset(next)
})

timeAxisSelect.addEventListener('change', () => {
  const next = timeAxisSelect.value
  if (next !== 'dynamic' && next !== 'fixed' && next !== 'window') {
    return
  }
  config.lineTimeAxisMode = next
  if (chartType === 'line') {
    rebuildChart()
    renderFrame(currentFrame)
  }
})

globalThis.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
    return
  }
  if (data.length === 0) {
    return
  }
  switch (e.code) {
    case 'Space': {
      e.preventDefault()
      setPauseState(!isPaused)
      break
    }
    case 'ArrowLeft': {
      e.preventDefault()
      stepBy(e.shiftKey ? -10 : -1)
      break
    }
    case 'ArrowRight': {
      e.preventDefault()
      stepBy(e.shiftKey ? 10 : 1)
      break
    }
    case 'Home': {
      e.preventDefault()
      setPauseState(true)
      renderFrame(0)
      break
    }
    case 'End': {
      e.preventDefault()
      setPauseState(true)
      renderFrame(data.length - 1)
      break
    }
    case 'BracketLeft': {
      e.preventDefault()
      adjustSpeed(-1)
      break
    }
    case 'BracketRight': {
      e.preventDefault()
      adjustSpeed(1)
      break
    }
  }
})

function handleResize() {
  const { width, height } = getContainerSize()
  applyConfigSize(width, height)
  app.renderer.resize(width, height)
  rebuildChart()
}

// 原始 CSV 按文件缓存：切回已加载过的数据集 / 调 boost 时不重复下载，只重跑处理。
const rawRowsCache = new Map<string, DSVRowArray<string>>()
async function loadData() {
  let rawRows = rawRowsCache.get(activeDataset.file)
  if (!rawRows) {
    rawRows = await csv(activeDataset.file)
    rawRowsCache.set(activeDataset.file, rawRows)
  }
  data = DataProcessor.processRows(rawRows, config)
  const m = computeInversionMetrics(data, { fps: config.fps })
  metricsLabel.textContent = `逆序对×帧 ${m.inversionPairFrames} · 惯性 ${m.smoothnessEnergy.toFixed(0)}`
}

// 切换数据集：重建 config、按当前画布尺寸布局、重新加载并从首帧播放。
async function loadDataset(next: typeof activeDataset) {
  activeDataset = next
  config = next.makeConfig()
  boostSlider.value = config.swapAccelBoost.toString()
  boostLabel.textContent = `boost ${config.swapAccelBoost.toFixed(1)}`
  timeAxisSelect.value = config.lineTimeAxisMode

  const { width, height } = getContainerSize()
  applyConfigSize(width, height)

  await loadData()
  const maxFrame = Math.max(data.length - 1, 0)
  progress.max = maxFrame.toString()
  progress.disabled = data.length === 0
  currentFrame = 0
  frameAccumulator = 0
  rebuildChart()
  renderFrame(0)
}

let boostRaf: number | undefined
boostSlider.addEventListener('input', () => {
  config.swapAccelBoost = Number(boostSlider.value)
  boostLabel.textContent = `boost ${config.swapAccelBoost.toFixed(1)}`
  // 合并一帧内的多次拖动，只重算一次
  if (boostRaf !== undefined) {
    return
  }
  boostRaf = requestAnimationFrame(async () => {
    boostRaf = undefined
    const keepFrame = currentFrame
    await loadData()
    const maxFrame = Math.max(data.length - 1, 0)
    progress.max = maxFrame.toString()
    currentFrame = Math.min(keepFrame, maxFrame)
    rebuildChart()
    renderFrame(currentFrame)
  })
})

;(async () => {
  try {
    await app.init({
      backgroundColor: config.backgroundColor,
      hello: true,
    })

    canvasContainer.append(app.canvas)
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.display = 'block'

    const { width, height } = getContainerSize()
    applyConfigSize(width, height)
    app.renderer.resize(width, height)

    window.addEventListener('resize', handleResize)

    await loadData()
    const maxFrame = Math.max(data.length - 1, 0)
    progress.max = maxFrame.toString()
    progress.disabled = data.length === 0
    currentFrame = 0
    rebuildChart()
    renderFrame(currentFrame)
    setPauseState(false)
    syncButtonState()
    syncTimeLabel()
    if (animationFrameId !== undefined) {
      cancelAnimationFrame(animationFrameId)
    }
    lastLoopTime = 0
    animationFrameId = requestAnimationFrame(loop)
  }
  catch (error) {
    console.error('Failed to load demo:', error)
  }
})()
