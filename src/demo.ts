import type { RankedData } from './Data'
import dayjs from 'dayjs'
import { Application } from 'pixi.js'
import { BarChart } from './BarChart'
import { Config } from './Config'
import { DataProcessor } from './DataProcessor'
import { LineChart } from './LineChart'

const app = new Application()
const ratingFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const config = new Config({
  idField: 'model',
  labelField: 'model',
  valueField: 'rating',
  stepField: 'date',
  totalDurationSec: 60,
  colorField: 'company',
  topN: 16,
  showLabel: false,
  showStepLabel: true,
  valueScaleType: 'adaptive',
  getStep: d => Number(d.date) * 1000,
  getStepLabel: step => dayjs(step).format('YYYY-MM-DD'),
  getValueLabel: data => ratingFormatter.format(data.value),
  getValueExtra: data => data.raw.company ?? '',
  getBarInfo: data => data.raw.model ?? data.id,
  title: 'LLM Elo Rating Leaderboard',
})

type ChartInstance = BarChart | LineChart
const chartPreferences = {
  bar: {
    showLabel: false,
    title: 'LLM Elo Rating Leaderboard',
    xAxisLabel: '',
  },
  line: {
    showLabel: true,
    title: 'LLM Elo Rating Trend',
    xAxisLabel: 'LLM Elo Rating',
  },
} as const

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
controls.style.position = 'absolute'
controls.style.left = '50%'
controls.style.bottom = '24px'
controls.style.transform = 'translateX(-50%)'
controls.style.display = 'flex'
controls.style.alignItems = 'center'
controls.style.gap = '10px'
controls.style.padding = '10px 14px'
controls.style.background = 'rgba(0, 0, 0, 0.56)'
controls.style.borderRadius = '12px'
controls.style.backdropFilter = 'blur(6px)'
controls.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.45)'
controls.style.userSelect = 'none'
canvasContainer.append(controls)

function makeButton(label: string, title: string) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  btn.style.padding = '4px 10px'
  btn.style.minWidth = '34px'
  btn.style.height = '30px'
  btn.style.background = 'rgba(255, 255, 255, 0.12)'
  btn.style.border = '1px solid rgba(255, 255, 255, 0.24)'
  btn.style.borderRadius = '6px'
  btn.style.color = '#ffffff'
  btn.style.fontSize = '14px'
  btn.style.fontFamily = 'inherit'
  btn.style.cursor = 'pointer'
  btn.style.transition = 'background 0.15s ease'
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.22)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.12)'
  })
  return btn
}

function makeSelect() {
  const sel = document.createElement('select')
  sel.style.padding = '4px 8px'
  sel.style.height = '30px'
  sel.style.background = 'rgba(255, 255, 255, 0.12)'
  sel.style.border = '1px solid rgba(255, 255, 255, 0.24)'
  sel.style.borderRadius = '6px'
  sel.style.color = '#ffffff'
  sel.style.fontSize = '13px'
  sel.style.fontFamily = 'inherit'
  sel.style.cursor = 'pointer'
  return sel
}

const chartSelect = makeSelect()
chartSelect.add(new Option('Bar', 'bar'))
chartSelect.add(new Option('Line', 'line'))
chartSelect.value = 'bar'
chartSelect.title = '图表类型'

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
progress.style.width = '260px'
progress.style.cursor = 'pointer'

const timeLabel = document.createElement('span')
timeLabel.textContent = '00:00 / 00:00'
timeLabel.style.fontSize = '13px'
timeLabel.style.minWidth = '110px'
timeLabel.style.textAlign = 'center'
timeLabel.style.fontVariantNumeric = 'tabular-nums'

const frameLabel = document.createElement('span')
frameLabel.textContent = 'f0 / f0'
frameLabel.style.fontSize = '13px'
frameLabel.style.minWidth = '110px'
frameLabel.style.textAlign = 'center'
frameLabel.style.fontVariantNumeric = 'tabular-nums'
frameLabel.style.color = '#9aa0a6'
frameLabel.title = '当前帧 / 总帧数'

const speedSelect = makeSelect()
for (const s of SPEED_OPTIONS) {
  speedSelect.add(new Option(`${s}x`, s.toString()))
}
speedSelect.value = '1'
speedSelect.title = '播放速率 ([ / ])'

controls.append(
  chartSelect,
  firstFrameBtn,
  prevFrameBtn,
  toggleButton,
  nextFrameBtn,
  lastFrameBtn,
  progress,
  timeLabel,
  frameLabel,
  speedSelect,
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

function renderFrame(frame: number) {
  if (!chart || data.length === 0) {
    return
  }
  const safeFrame = Math.min(Math.max(frame, 0), data.length - 1)
  chart.update(safeFrame)
  progress.value = safeFrame.toString()
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

function rebuildChart() {
  if (data.length === 0) {
    return
  }
  if (chart) {
    chart.removeFromParent()
    chart.destroy({ children: true })
  }
  const preference = chartPreferences[chartType]
  config.showLabel = preference.showLabel
  config.title = preference.title
  config.xAxisLabel = preference.xAxisLabel

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
  const currentIdx = SPEED_OPTIONS.findIndex(s => s === speed)
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

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
    return
  }
  if (data.length === 0) {
    return
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      setPauseState(!isPaused)
      break
    case 'ArrowLeft':
      e.preventDefault()
      stepBy(e.shiftKey ? -10 : -1)
      break
    case 'ArrowRight':
      e.preventDefault()
      stepBy(e.shiftKey ? 10 : 1)
      break
    case 'Home':
      e.preventDefault()
      setPauseState(true)
      renderFrame(0)
      break
    case 'End':
      e.preventDefault()
      setPauseState(true)
      renderFrame(data.length - 1)
      break
    case 'BracketLeft':
      e.preventDefault()
      adjustSpeed(-1)
      break
    case 'BracketRight':
      e.preventDefault()
      adjustSpeed(1)
      break
  }
})

function handleResize() {
  const { width, height } = getContainerSize()
  applyConfigSize(width, height)
  app.renderer.resize(width, height)
  rebuildChart()
}

(async () => {
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

    data = await DataProcessor.processCSV('/llm.csv', config)
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
