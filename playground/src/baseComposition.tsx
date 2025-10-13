import { timeFormat } from 'd3'
import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { BarChart } from '../../src/BarChart'
import { Config } from '../../src/Config'
import { DataProcessor } from '../../src/DataProcessor'
import { colors } from '../../src/main'

const colorMap = new Map([
  ['OpenAI', 0x74_A8_9B],
  ['Google', 0xFE_51_4D],
  ['Anthropic', 0xD2_75_56],
  ['Meta', 0x00_5F_D5],
  ['微软', 0x00_A1_F1],
  ['阿里巴巴', 0xFF_6C_00],
  ['Alibaba', 0xFF_6C_00],
  ['Mistral AI', 0xFF_70_00],
  ['亚马逊', 0xFF_99_00],
  ['Amazon', 0xFF_99_00],
  ['Databricks', 0xFF_36_21],
  ['深度求索', 0x41_69_E1],
  ['DeepSeek', 0x41_69_E1],
  ['腾讯', 0x16_8E_FF],
  ['MiniMax AI', 0xB1_65_FF],
  ['零一万物', 0x18_4B_39],
  ['艾伦人工智能研究所（AI2）', 0x23_4F_1E],
  ['AI2', 0x23_4F_1E],
  ['英伟达', 0x76_B9_00],
  ['Nvidia', 0x76_B9_00],
  ['NVIDIA', 0x76_B9_00],
  ['IBM', 0x24_75_B2],
  ['技术创新研究院（TII）', 0x77_44_FF],
  ['Perplexity AI', 0xAD_2E_FF],
  ['Cohere', 0xFF_D6_00],
  ['Snowflake', 0x56_B9_FF],
  ['Upstage AI', 0xD7_3B_E2],
  ['HuggingFace', 0xFF_D2_1F],
  ['Nous Research', 0x11_AA_99],
  ['Teknium', 0xA0_10_6E],
  ['LMSYS', 0x7A_00_D6],
  ['Ollama / 社区', 0x55_44_66],
  ['社区', 0x88_88_88],
  ['Tatsu Lab', 0x19_19_70],
  ['BAIR', 0x1E_68_2E],
  ['Nexusflow', 0xB2_15_56],
  ['上海人工智能实验室', 0x0B_46_50],
  ['RWKV 社区', 0x9B_4F_C7],
  ['斯坦福大学', 0xB1_04_0E],
  ['LAION / OpenAssistant', 0xA3_C6_44],
  ['C4AI（阿根廷）', 0xE8_55_55],
  ['Reka AI', 0x78_3E_96],
  ['Magistral AI', 0xDC_B2_39],
  ['BAAI（QWQ 团队）', 0x18_A3_B6],
  ['Step AI / 社区', 0xFF_4F_81],
  ['SmolLM 项目 / 社区', 0xB7_A3_FF],
  ['Eric Hartford / 社区', 0xA9_96_7B],
  ['AI21 Labs', 0xD9_27_67],
  ['LMSys', 0x4D_76_A5],
  ['OpenChat', 0xA6_B1_15],
  ['xAI', 0x6B_4F_7F],
  ['智谱AI', 0x6B_4F_7F],
  ['Zhipu AI', 0x49_7A_9A],
  ['Moonshot', 0x32_63_DD],
  ['Tencent', 0x41_69_E1],
])

const modelNameMap = new Map([

])

const config = new Config({
  idField: 'company',
  stepField: 'date',
  valueField: 'rating',
  xAxisLabel: 'LMSYS Chatbot Arena Elo Rating',
  maxRetentionTimeSec: 5,
  getStepLabel(step) {
    const date = new Date(step * 1000)
    return timeFormat('%Y-%m-%d')(date)
  },
  swapDurationSec: 0.5,
  valueScaleType: 'from-delta',
  valueScaleDelta: 250,
  y: 0,
  transitionDurationSec: 2,
  labelField: '-',
  topN: 16,
  totalDurationSec: 120,
  getColor: (d) => {
    if (colorMap.has(d.id)) {
      return colorMap.get(d.id)
    }
    const colorStr = colors(d.id)
    return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x00_00_00
  },
  getBarInfo: (d) => {
    const modelName = modelNameMap.get(d.raw?.model || d.model) || d.raw?.model || d.model || 'Unknown Model'
    return `${modelName} - ${d.id}`
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
