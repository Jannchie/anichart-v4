/* eslint-disable unicorn/prefer-top-level-await */
import type { RankedData } from './Data'
import { Application } from 'pixi.js'
import { BarChart } from './BarChart'
import { Config } from './Config'
import { DataProcessor } from './DataProcessor'

const app = new Application()
const config = new Config()

// Prepare base layout
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
document.body.style.fontFamily = 'Inter, system-ui, sans-serif'
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
controls.style.gap = '12px'
controls.style.padding = '10px 14px'
controls.style.background = 'rgba(0, 0, 0, 0.56)'
controls.style.borderRadius = '12px'
controls.style.backdropFilter = 'blur(6px)'
controls.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.45)'
canvasContainer.append(controls)

const toggleButton = document.createElement('button')
toggleButton.textContent = '暂停'

function applyButtonStyle(button: HTMLButtonElement) {
  button.style.padding = '6px 12px'
  button.style.background = 'rgba(255, 255, 255, 0.12)'
  button.style.border = '1px solid rgba(255, 255, 255, 0.24)'
  button.style.borderRadius = '6px'
  button.style.color = '#ffffff'
  button.style.fontSize = '14px'
  button.style.fontFamily = 'inherit'
  button.style.cursor = 'pointer'
  button.style.transition = 'opacity 0.2s ease'
}

applyButtonStyle(toggleButton)

const progress = document.createElement('input')
progress.type = 'range'
progress.min = '0'
progress.max = '0'
progress.value = '0'
progress.step = '1'
progress.style.width = '260px'
progress.style.cursor = 'pointer'

controls.append(toggleButton, progress)

let data: RankedData[][] = []
let barChart: BarChart | null = null
let animationFrameId: number | undefined
let isPaused = false
let currentFrame = 0
let resumeAfterScrub = false

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
  // Keep a small padding to match default positioning
  config.width = Math.max(width - 20, 0)
  config.height = Math.max(height - 20, 0)
}

function syncButtonState() {
  toggleButton.textContent = isPaused ? '继续' : '暂停'
}

function setPauseState(paused: boolean) {
  isPaused = paused
  syncButtonState()
}

function renderFrame(frame: number) {
  if (!barChart || data.length === 0) {
    return
  }
  const safeFrame = Math.min(Math.max(frame, 0), data.length - 1)
  barChart.update(safeFrame)
  progress.value = safeFrame.toString()
  currentFrame = safeFrame
}

function rebuildChart() {
  if (data.length === 0) {
    return
  }
  if (barChart) {
    barChart.remove()
    barChart.destroy({ children: true })
  }
  barChart = new BarChart(data, config)
  app.stage.addChild(barChart)
  renderFrame(currentFrame)
}

function loop() {
  if (!isPaused && data.length > 0) {
    renderFrame(currentFrame)
    currentFrame = (currentFrame + 1) % data.length
  }
  animationFrameId = requestAnimationFrame(loop)
}

toggleButton.addEventListener('click', () => {
  setPauseState(!isPaused)
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

    data = await DataProcessor.processCSV('/base.csv', config)
    const maxFrame = Math.max(data.length - 1, 0)
    progress.max = maxFrame.toString()
    progress.disabled = data.length === 0
    currentFrame = 0
    rebuildChart()
    renderFrame(currentFrame)
    setPauseState(false)
    syncButtonState()
    if (animationFrameId !== undefined) {
      cancelAnimationFrame(animationFrameId)
    }
    loop()
  }
  catch (error) {
    console.error('Failed to load demo:', error)
  }
})()
