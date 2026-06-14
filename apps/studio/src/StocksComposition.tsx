import { BarChart, colors, Config, DataProcessor, textureMap } from '@anichart/core'
import { timeFormat } from 'd3'
import { Application, Texture } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadBerkeleyMono } from './fonts'

// 美股市值 race 的 Remotion composition（与 apps/playground/src/datasets.ts 的 'stocks' 条目一致）。
// 数据 stocks.csv 来自 scripts/update-stocks-data.py；公司展示名同时是 public/logos/ 的文件名。
// 接法与 GoComposition 一致：作为独立 composition 文件存在，渲染时再挂到 Root。
const colorMap = new Map([
  ['Apple', 0xA3_AA_AE],
  ['Microsoft', 0x00_A4_EF],
  ['Alphabet', 0x42_85_F4],
  ['Amazon', 0xFF_99_00],
  ['Nvidia', 0x76_B9_00],
  ['Meta', 0x08_66_FF],
  ['Broadcom', 0x9B_1C_31],
  ['Tesla', 0xE8_21_27],
  ['JPMorgan Chase', 0x11_7A_CA],
  ['Eli Lilly', 0xE1_25_1B],
  ['Visa', 0x1A_1F_71],
  ['ExxonMobil', 0xCE_11_26],
  ['Walmart', 0xFD_BB_30],
  ['Mastercard', 0xFF_5F_00],
  ['UnitedHealth', 0x00_26_77],
  ['Oracle', 0xF8_00_00],
  ['Johnson & Johnson', 0xCC_00_00],
  ['Procter & Gamble', 0x00_4B_8D],
  ['Home Depot', 0xF9_63_02],
  ['Costco', 0x00_5D_AA],
  ['Chevron', 0x00_66_B2],
  ['Coca-Cola', 0xF4_00_09],
  ['Bank of America', 0xE3_18_37],
  ['Citigroup', 0x05_6D_AE],
  ['SpaceX', 0x8B_5C_F6],
  ['Netflix', 0xE5_09_14],
  ['Salesforce', 0x00_A1_E0],
  ['AMD', 0xED_1C_24],
  ['PepsiCo', 0x00_4B_93],
  ['Adobe', 0xFA_0F_00],
  ['Qualcomm', 0x32_53_DC],
  ['Disney', 0x1A_75_CF],
  ['Cisco', 0x04_9F_D9],
  ['Intel', 0x00_71_C5],
  ['Pfizer', 0x00_93_D0],
  ['GE', 0x60_9E_E0],
  ['IBM', 0x05_30_AD],
  ['AT&T', 0x00_A8_E0],
  ['Verizon', 0xCD_04_0B],
  ['Wells Fargo', 0xD7_1E_28],
  ['McDonald\'s', 0xFF_C7_2C],
  ['AbbVie', 0x07_1D_49],
  ['Merck', 0x00_85_7C],
])

function formatUSD(v: number): string {
  if (v >= 1e12) {
    return `$${(v / 1e12).toFixed(2)}T`
  }
  if (v >= 1e9) {
    return `$${(v / 1e9).toFixed(0)}B`
  }
  return `$${(v / 1e6).toFixed(0)}M`
}

const config = new Config({
  id: 'company',
  step: 'date',
  value: 'marketcap',
  image: 'company',
  // 市值是绝对量，from-zero 才诚实（柱长 ∝ 真实市值）。
  valueScale: { type: 'from-zero' },
  xAxisLabel: 'Market Capitalization (USD)',
  title: 'US Stock Market Cap',
  subtitle: 'SEC EDGAR + Yahoo Finance · SpaceX pre-IPO = reported private valuations',
  getStepLabel(step) {
    return timeFormat('%Y-%m')(new Date(step * 1000))
  },
  y: 0,
  label: '-',
  topN: 15,
  totalDurationSec: 120,
  color: (d) => {
    if (colorMap.has(d.id)) {
      return colorMap.get(d.id)
    }
    const colorStr = colors(d.id)
    return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x88_88_88
  },
  // 有 logo 时公司由 icon 表达，bar 上只补 ticker；无 logo 才回退「公司名 (ticker)」。
  getBarInfo: d => textureMap.has(d.id) ? (d.raw?.ticker ?? d.id) : `${d.id} (${d.raw?.ticker ?? ''})`,
  getValueLabel: d => formatUSD(d.value),
  getTickLabel: v => formatUSD(v),
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
  // 字体与 CSV 并行加载；BarChart 构建（创建 PIXI Text）前必须 await，否则文本按回退字体测量（衬线）。
  const fontReady = loadBerkeleyMono()
  const data = await DataProcessor.processCSV(staticFile('stocks.csv'), config)

  // 公司 logo：BarChart 构建时从 textureMap 取图，所以要先加载完（与 baseComposition 一致）。
  const LOGO_PADDING_RATIO = 0.14
  const companies = [...new Set(data.flat().map(d => d.id))]
  await Promise.all(companies.map(async (company) => {
    if (textureMap.has(company)) {
      return
    }
    try {
      const image = new Image()
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

  await fontReady
  const barChart = new BarChart(data, config)
  app.stage.addChild(barChart)
  barChart.update(0)
  return barChart
}

export function StocksComposition() {
  const bar = useRef<BarChart>(undefined)
  const { width, height, fps, durationInFrames } = useVideoConfig()
  const [handle] = useState(() => delayRender())
  const frame = useCurrentFrame()
  // 渲染时每个并发 chunk 的首帧都以「挂载帧」重新 mount；init 收尾的 update(0) 会让这些帧闪回起始态。
  // 用 ref 记住当前帧，init 完成时同步渲到该帧（而非 0），消除 chunk 首帧闪烁。
  const frameRef = useRef(frame)
  frameRef.current = frame
  useEffect(() => {
    init({
      fps,
      width,
      height,
      durationInFrames,
    }).then((res) => {
      bar.current = res
      res.update(frameRef.current)
      continueRender(handle)
    })
  }, [])

  useEffect(() => {
    if (bar.current) {
      bar.current.update(frame)
    }
  }, [frame])

  return (
    <canvas id="canvas-el" />
  )
}
