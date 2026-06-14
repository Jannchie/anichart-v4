import type { RankedData } from '@anichart/core'
import { BarChart, Config, DataProcessor, textureMap } from '@anichart/core'
import { timeFormat } from 'd3'
import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { AA_BGM_SEC } from './AAComposition'
import { loadCjkFonts } from './fonts'
import { llmColor, loadCompanyLogos } from './llmChart'

// AAComposition 的中文版：同一份 llm-aa.csv / 时长 / BGM，仅标题、副标题、字体、柱上文案不同。
// 国产公司的模型名换成中文代号（保留版本后缀）；海外公司保持英文（GPT-5.1 / Claude …）。
// 英文系列名 → 中文：能整体替换的直接换（Qwen→通义千问），习惯连用英文型号的加中文前缀（GLM→智谱 GLM）。
const ZH_MODEL: Record<string, (m: string) => string> = {
  'Alibaba': m => m.replaceAll('QwQ', '通义千问 QwQ').replaceAll('Qwen', '通义千问'),
  'Baidu': m => m.replaceAll('ERNIE', '文心'),
  'DeepSeek': m => m.replaceAll('DeepSeek', '深度求索'),
  'ByteDance': m => m.includes('Doubao') ? m.replaceAll('Doubao', '豆包') : `豆包 ${m}`,
  'Tencent': m => m.replaceAll(/Hunyuan/gi, '混元').replaceAll(/\bHy(?=[\d-])/g, '混元'),
  'StepFun': m => m.replaceAll('Step', '阶跃'),
  'Z.ai': m => `智谱 ${m}`,
  'Xiaomi': m => `小米 ${m}`,
  'Ant Group': m => `蚂蚁 ${m}`,
  'LongCat': m => `美团 ${m}`,
  'China Mobile': m => `中国移动 ${m}`,
  'OpenBMB': m => `面壁 ${m}`,
  'Nanbeige': m => `南北阁 ${m}`,
  // MiniMax / Moonshot AI(Kimi) 已是通用品牌，保持英文。
}

function zhBarInfo(d: RankedData): string {
  const model = d.raw?.model || d.model || 'Unknown Model'
  const label = ZH_MODEL[d.id]?.(model) ?? model
  // 有 logo 时公司由 icon 表达，不再重复公司名；无 logo 才回退 "model - company"。
  return textureMap.has(d.id) ? label : `${label} - ${d.id}`
}

const config = new Config({
  id: 'company',
  step: 'date',
  value: 'rating',
  image: 'company',
  title: '谁是最强 AI？',
  subtitle: '各厂商历代最强模型 · 数据来源：Artificial Analysis (artificialanalysis.ai)',
  xAxisLabel: '',
  // 拉丁/数字走等宽 Berkeley Mono，汉字按字回退到 HarmonyOS Sans SC。
  fontFamily: 'Berkeley Mono, HarmonyOS Sans SC',
  getStepLabel(step) {
    return timeFormat('%Y-%m-%d')(new Date(step * 1000))
  },
  y: 0,
  label: '-',
  topN: 16,
  totalDurationSec: 120,
  color: d => llmColor(d.id),
  getValueLabel: d => d.value.toFixed(1),
  getBarInfo: zhBarInfo,
})
const app = new Application()

async function init({
  fps,
  width,
  height,
}: {
  fps: number
  width: number
  height: number
}) {
  config.fps = fps
  config.canvasWidth = width
  config.canvasHeight = height
  config.totalDurationSec = AA_BGM_SEC - config.swapDurationSec * 2
  // 中文版需 Berkeley Mono + HarmonyOS 两套；构建 BarChart 前必须 await（含汉字测量）。
  const fontReady = loadCjkFonts()
  const data = await DataProcessor.processCSV(staticFile('llm-aa.csv'), config)

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

export function AACompositionZh() {
  const bar = useRef<BarChart>(undefined)
  const { width, height, fps } = useVideoConfig()
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
    <>
      {/* 见 AAComposition：仅供 Studio 预览发声；成片 BGM 由 `pnpm render:aazh` 脚本 mux 上去。 */}
      <Audio src={staticFile('neon-route.wav')} volume={0.7} />
      <canvas id="canvas-el" />
    </>
  )
}
