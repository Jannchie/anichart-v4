import { BarChart, Config, DataProcessor, textureMap } from '@anichart/core'
import { timeFormat } from 'd3'
import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadBerkeleyMono } from './fonts'
import { llmColor, loadCompanyLogos } from './llmChart'

// BGM neon-route.wav 实测 56.72s。时长解耦：赛跑铺在 BGM 上、速度不变；BGM 奏完后再多停
// AA_TAIL_HOLD_SEC 秒在终榜（片尾定格卡，这几秒无音乐）。视频总长 = BGM + 定格。
export const AA_BGM_SEC = 56.72
export const AA_TAIL_HOLD_SEC = 3
export const AA_FPS = 60
export const AA_DURATION_IN_FRAMES = Math.round((AA_BGM_SEC + AA_TAIL_HOLD_SEC) * AA_FPS)

// Artificial Analysis Intelligence：一公司一柱，值 = 该公司截至当前已发布模型的
// 最高 Intelligence Index（running max，见 scripts/update-aa-data.py）。
// 配色 / logo 与 LLM Chatbot Arena 共用 llmChart，仅数据源、文案、数值格式不同。
const config = new Config({
  id: 'company',
  step: 'date',
  value: 'rating',
  image: 'company',
  title: 'The Race for the Smartest AI',
  subtitle: 'Each lab\'s best model over time · Data: Artificial Analysis (artificialanalysis.ai)',
  // 去掉值轴标题（原 'Intelligence Index'）：留出的顶部高度由 autoBarHeight 自动回收 —— 柱区上移、每根柱更高。
  xAxisLabel: '',
  getStepLabel(step) {
    return timeFormat('%Y-%m-%d')(new Date(step * 1000))
  },
  y: 0,
  label: '-',
  topN: 16,
  totalDurationSec: 120,
  color: d => llmColor(d.id),
  getValueLabel: d => d.value.toFixed(1),
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
}: {
  fps: number
  width: number
  height: number
}) {
  config.fps = fps
  config.canvasWidth = width
  config.canvasHeight = height
  // 赛跑时长跟着 BGM 走（速度不变，前期不会被压快）；尾部多出的 AA_TAIL_HOLD_SEC 帧由 BarChart.update
  // 越界提前返回自动冻结在终榜。注意：不要用 durationInFrames 推 totalDurationSec，否则定格帧会反过来拖慢赛跑。
  config.totalDurationSec = AA_BGM_SEC - config.swapDurationSec * 2
  // 字体与 CSV 并行加载；BarChart 构建（创建 PIXI Text）前必须 await 字体，否则文本按回退字体测量。
  const fontReady = loadBerkeleyMono()
  const data = await DataProcessor.processCSV(staticFile('llm-aa.csv'), config)

  await loadCompanyLogos([...new Set(data.flat().map(d => d.id))])
  await fontReady

  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
    roundPixels: true,
    antialias: true,
    // 布局坐标固定 1920×1080；按 devicePixelRatio 提升背景缓冲分辨率，使 Remotion --scale=2 时
    // 文字 / 矢量以 2× 原生渲染（真 4K 清晰，而非把 1080 画布放大）。scale=1 时 dpr=1，与原先一致。
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  document.querySelector('#canvas-el')?.replaceWith(app.canvas)

  const barChart = new BarChart(data, config)
  app.stage.addChild(barChart)
  barChart.update(0)
  return barChart
}

export function AAComposition() {
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
      {/* BGM：Suno 生成的 Neon Route（56.72s），播一遍到尾、不 loop；volume 可调（0~1）。
          注意：这套命令式 PIXI 画布结构下，Remotion 渲染会判定 shouldRenderAudio=false、丢掉 <Audio>，
          所以这里只为 Remotion Studio 预览发声；成片的 BGM 由 `pnpm render:aa` 脚本用 ffmpeg mux 上去。 */}
      <Audio src={staticFile('neon-route.wav')} volume={0.7} />
      <canvas id="canvas-el" />
    </>
  )
}
