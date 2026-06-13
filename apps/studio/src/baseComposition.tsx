import { BarChart, Config, DataProcessor, textureMap } from '@anichart/core'
import { timeFormat } from 'd3'
import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadBerkeleyMono } from './fonts'
import { llmColor, loadCompanyLogos } from './llmChart'

// LLM Chatbot Arena：每日演化的人类盲投 Elo。配色 / logo 与 AAComposition 共用 llmChart。
const config = new Config({
  id: 'company',
  step: 'date',
  value: 'rating',
  image: 'company',
  xAxisLabel: 'LMArena Elo Rating',
  getStepLabel(step) {
    const date = new Date(step * 1000)
    return timeFormat('%Y-%m-%d')(date)
  },
  y: 0,
  label: '-',
  topN: 16,
  totalDurationSec: 120,
  color: d => llmColor(d.id),
  getBarInfo: (d) => {
    const modelName = d.raw?.model || d.model || 'Unknown Model'
    // 有 logo 时公司由 icon 表达，不再重复公司名；无 logo 才回退 "model - company"。
    return textureMap.has(d.id) ? modelName : `${modelName} - ${d.id}`
  },
})
const app = new Application()

async function init({
  fps,
  width,
  height,
  durationInFrames,
}: {
  fps: number
  width: number
  height: number
  durationInFrames: number
}) {
  config.fps = fps
  config.canvasWidth = width
  config.canvasHeight = height
  config.totalDurationSec = durationInFrames / fps - config.swapDurationSec * 2
  const fontReady = loadBerkeleyMono()
  const data = await DataProcessor.processCSV(staticFile('llm.csv'), config)

  await loadCompanyLogos([...new Set(data.flat().map(d => d.id))])
  await fontReady

  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
    roundPixels: true,
    antialias: true,
    // 见 AAComposition：按 devicePixelRatio 提分辨率，配合 --scale 渲染真 4K。
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  document.querySelector('#canvas-el')?.replaceWith(app.canvas)

  const barChart = new BarChart(data, config)
  app.stage.addChild(barChart)
  barChart.update(0)
  return barChart
}

export function BaseComposition() {
  const bar = useRef<BarChart>(undefined)
  const { width, height, fps, durationInFrames } = useVideoConfig()
  const [handle] = useState(() => delayRender())
  useEffect(() => {
    init({
      fps,
      width,
      height,
      durationInFrames,
    }).then((res) => {
      bar.current = res
      continueRender(handle)
    })
  }, [])
  const frame = useCurrentFrame()

  useEffect(() => {
    if (bar.current) {
      bar.current.update(frame)
    }
  }, [frame])

  return (
    <canvas id="canvas-el" />
  )
}
