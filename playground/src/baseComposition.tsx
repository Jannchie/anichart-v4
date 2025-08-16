import { timeFormat } from 'd3'
import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { BarChart } from '../../src/BarChart'
import { Config } from '../../src/Config'
import { DataProcessor } from '../../src/DataProcessor'
import { colors } from '../../src/main'

const colorMap = new Map([
  ['OpenAI', 0x74A89B],
  ['Google', 0xFE514D],
  ['Anthropic', 0xD27556],
  ['Meta', 0x005FD5],
  ['微软', 0x00A1F1],
  ['阿里巴巴', 0xFF6C00],
  ['Alibaba', 0xFF6C00],
  ['Mistral AI', 0xFF7000],
  ['亚马逊', 0xFF9900],
  ['Databricks', 0xFF3621],
  ['深度求索', 0x4169E1],
  ['DeepSeek', 0x4169E1],
  ['腾讯', 0x168EFF],
  ['MiniMax AI', 0xB165FF],
  ['零一万物', 0x184B39],
  ['艾伦人工智能研究所（AI2）', 0x234F1E],
  ['AI2', 0x234F1E],
  ['英伟达', 0x76B900],
  ['Nvidia', 0x76B900],
  ['NVIDIA', 0x76B900],
  ['IBM', 0x2475B2],
  ['技术创新研究院（TII）', 0x7744FF],
  ['Perplexity AI', 0xAD2EFF],
  ['Cohere', 0xFFD600],
  ['Snowflake', 0x56B9FF],
  ['Upstage AI', 0xD73BE2],
  ['HuggingFace', 0xFFD21F],
  ['Nous Research', 0x11AA99],
  ['Teknium', 0xA0106E],
  ['LMSYS', 0x7A00D6],
  ['Ollama / 社区', 0x554466],
  ['社区', 0x888888],
  ['Tatsu Lab', 0x191970],
  ['BAIR', 0x1E682E],
  ['Nexusflow', 0xB21556],
  ['上海人工智能实验室', 0x0B4650],
  ['RWKV 社区', 0x9B4FC7],
  ['斯坦福大学', 0xB1040E],
  ['LAION / OpenAssistant', 0xA3C644],
  ['C4AI（阿根廷）', 0xE85555],
  ['Reka AI', 0x783E96],
  ['Magistral AI', 0xDCB239],
  ['BAAI（QWQ 团队）', 0x18A3B6],
  ['Step AI / 社区', 0xFF4F81],
  ['SmolLM 项目 / 社区', 0xB7A3FF],
  ['Eric Hartford / 社区', 0xA9967B],
  ['AI21 Labs', 0xD92767],
  ['LMSys', 0x4D76A5],
  ['OpenChat', 0xA6B115],
  ['xAI', 0x6B4F7F],
  ['智谱AI', 0x6B4F7F],
  ['Zhipu AI', 0x497A9A],
  ['Moonshot', 0x3263DD],
  ['Tencent', 0x4169E1],
])

const companyNameMap = new Map([
  ['OpenAI', 'OpenAI'],
  ['Moonshot', '月之暗面'],
  ['NVIDIA', '英伟达'],
  ['Google', 'Google'],
  ['Anthropic', 'Anthropic'],
  ['Meta', 'Meta'],
  ['Microsoft', '微软'],
  ['Alibaba', '阿里巴巴'],
  ['Mistral AI', 'Mistral AI'],
  ['Amazon', '亚马逊'],
  ['Databricks', 'Databricks'],
  ['DeepSeek', '深度求索'],
  ['Tencent', '腾讯'],
  ['MiniMax AI', 'MiniMax AI'],
  ['01.AI', '零一万物'],
  ['AI2', 'AI2'],
  ['IBM', 'IBM'],
  ['TII', 'TII'],
  ['Perplexity AI', 'Perplexity AI'],
  ['Cohere', 'Cohere'],
  ['Snowflake', 'Snowflake'],
  ['Upstage AI', 'Upstage AI'],
  ['HuggingFace', 'HuggingFace'],
  ['Nous Research', 'Nous Research'],
  ['Teknium', 'Teknium'],
  ['LMSYS', 'LMSYS'],
  ['Community', '社区'],
  ['Tatsu Lab', 'Tatsu Lab'],
  ['BAIR', 'BAIR'],
  ['Nexusflow', 'Nexusflow'],
  ['Shanghai AI Lab', '上海人工智能实验室'],
  ['RWKV Community', 'RWKV 社区'],
  ['Stanford', '斯坦福大学'],
  ['LAION', 'LAION / OpenAssistant'],
  ['Reka AI', 'Reka AI'],
  ['Magistral AI', 'Magistral AI'],
  ['Step AI', 'Step AI / 社区'],
  ['SmolLM', 'SmolLM 项目 / 社区'],
  ['Eric Hartford', 'Eric Hartford / 社区'],
  ['AI21 Labs', 'AI21 Labs'],
  ['LMSys', 'LMSys'],
  ['OpenChat', 'OpenChat'],
  ['xAI', 'xAI'],
  ['Zhipu AI', '智谱AI'],
  ['Moonshot', '月之暗面'],
])

const modelNameMap = new Map([

])

const config = new Config({
  idField: 'company',
  stepField: 'date',
  valueField: 'rating',
  xAxisLabel: 'LMSYS 聊天机器人竞技场 Elo 评分',
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
  getColor: (d) => {
    if (colorMap.has(d.id)) {
      return colorMap.get(d.id)
    }
    const colorStr = colors(d.id)
    return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x000000
  },
  getBarInfo: (d) => {
    const modelName = modelNameMap.get(d.raw?.model || d.model) || d.raw?.model || d.model || 'Unknown Model'
    const companyName = companyNameMap.get(d.id) || d.id
    return `${modelName} - ${companyName}`
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
  document.getElementById('canvas-el')?.replaceWith(app.canvas)

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
