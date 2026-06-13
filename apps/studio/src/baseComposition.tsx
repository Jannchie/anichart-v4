import { BarChart, colors, Config, DataProcessor, textureMap } from '@anichart/core'
import { timeFormat } from 'd3'
import { Application, Texture } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

// 与 apps/playground/src/datasets.ts 保持一致：公司展示名出自
// scripts/update-llm-data.py，同时是 public/logos/ 下的 logo 文件名。
const colorMap = new Map([
  ['OpenAI', 0x74_A8_9B],
  ['Google', 0xFE_51_4D],
  ['Anthropic', 0xD2_75_56],
  ['Meta', 0x00_5F_D5],
  ['Microsoft', 0x00_A1_F1],
  ['Alibaba', 0xFF_6C_00],
  ['Mistral AI', 0xFF_70_00],
  ['Amazon', 0xFF_99_00],
  ['Databricks', 0xFF_36_21],
  ['DeepSeek', 0x41_69_E1],
  ['Tencent', 0x16_8E_FF],
  ['MiniMax', 0xB1_65_FF],
  ['01.AI', 0x18_4B_39],
  ['AI2', 0x23_4F_1E],
  ['NVIDIA', 0x76_B9_00],
  ['IBM', 0x24_75_B2],
  ['TII', 0x77_44_FF],
  ['Perplexity AI', 0xAD_2E_FF],
  ['Cohere', 0xFF_D6_00],
  ['Snowflake', 0x56_B9_FF],
  ['Upstage', 0xD7_3B_E2],
  ['Hugging Face', 0xFF_D2_1F],
  ['Nous Research', 0x11_AA_99],
  ['LMSYS', 0x7A_00_D6],
  ['Stanford', 0xB1_04_0E],
  ['UC Berkeley', 0x1E_68_2E],
  ['Nexusflow', 0xB2_15_56],
  ['InternLM', 0x0B_46_50],
  ['RWKV', 0x9B_4F_C7],
  ['OpenAssistant', 0xA3_C6_44],
  ['Reka AI', 0x78_3E_96],
  ['StepFun', 0xFF_4F_81],
  ['Nomic AI', 0x4F_8A_C7],
  ['Cognitive Computations', 0xA9_96_7B],
  ['AI21 Labs', 0xD9_27_67],
  ['OpenChat', 0xA6_B1_15],
  ['Stability AI', 0x6B_4F_7F],
  ['xAI', 0x8A_8A_93],
  ['Z.ai', 0x49_7A_9A],
  ['Moonshot AI', 0x32_63_DD],
  ['Baidu', 0x29_32_E1],
  ['ByteDance', 0x32_5A_B4],
  ['Xiaomi', 0xFF_69_00],
  ['Meituan', 0xFF_D1_00],
  ['Ant Group', 0x16_77_FF],
  ['Inception AI', 0x7C_3A_ED],
  ['Prime Intellect', 0x00_B2_A9],
  ['Together AI', 0x0F_6F_FF],
  ['Arcee AI', 0xD2_3F_57],
  ['MosaicML', 0xE0_38_3D],
  ['Tsinghua', 0x66_08_74],
  ['Princeton', 0xF5_80_25],
])

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
  color: (d) => {
    if (colorMap.has(d.id)) {
      return colorMap.get(d.id)
    }
    const colorStr = colors(d.id)
    return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x00_00_00
  },
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
  const data = await DataProcessor.processCSV(staticFile('llm.csv'), config)

  // 公司 logo：BarChart 构建时从 textureMap 取图，所以要先加载完。
  // 透明底的单色 glyph（lobehub 图标）贴边太挤，加一圈透明边距；不透明的方形
  // 头像（GitHub 组织头像等）保持贴边（与 playground 一致）。
  const LOGO_PADDING_RATIO = 0.14
  const companies = [...new Set(data.flat().map(d => d.id))]
  await Promise.all(companies.map(async (company) => {
    if (textureMap.has(company)) {
      return
    }
    try {
      const image = new Image()
      // 原始公司名直接交给 staticFile：Remotion 4.0 起 staticFile 自己会逐段 encodeURIComponent，
      // 若这里再手动编码会双重编码（"Hugging Face" → Hugging%2520Face.png → 404，logo 静默丢失）。
      image.src = staticFile(`logos/${company}.png`)
      await image.decode()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      canvas.width = image.width
      canvas.height = image.height
      ctx.drawImage(image, 0, 0)
      const { width: w, height: h } = canvas
      const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
      const isGlyph = corners.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 255)
      if (isGlyph) {
        const pad = Math.round(Math.max(w, h) * LOGO_PADDING_RATIO)
        canvas.width = w + pad * 2
        canvas.height = h + pad * 2
        canvas.getContext('2d')!.drawImage(image, pad, pad)
      }
      textureMap.set(company, Texture.from(canvas))
    }
    catch {
      // 没有 logo 的公司跳过
    }
  }))
  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
    roundPixels: true,
    antialias: true,
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
