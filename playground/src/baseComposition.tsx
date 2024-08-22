import { Application } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { timeFormat } from 'd3'
import { Config } from '../../src/Config'
import { DataProcessor } from '../../src/DataProcessor'
import { BarChart } from '../../src/BarChart'
import { colors } from '../../src/main'

const nameDict = {
  'gpt-4-0314': 'GPT 4 (03/14)',
  'claude-1': 'Claude 1',
  'vicuna-13b': 'Vicuna 13B',
  'gpt-3.5-turbo-0314': 'GPT 3.5 Turbo (03/14)',
  'claude-instant-1': 'Claude Instant 1',
  'vicuna-33b': 'Vicuna 33B',
  'palm-2': 'Palm 2',
  'koala-13b': 'Koala 13B',
  'guanaco-33b': 'Guanaco 33B',
  'mpt-30b-chat': 'MPT 30B Chat',
  'wizardlm-13b': 'WizardLM 13B',
  'alpaca-13b': 'Alpaca 13B',
  'vicuna-7b': 'Vicuna 7B',
  'oasst-pythia-12b': 'OASST Pythia 12B',
  'RWKV-4-Raven-14B': 'RWKV 4 Raven 14B',
  'chatglm-6b': 'ChatGLM 6B',
  'mpt-7b-chat': 'MPT 7B Chat',
  'gpt4all-13b-snoozy': 'GPT4All 13B Snoozy',
  'gpt-4-0613': 'GPT 4 (06/13)',
  'gpt-3.5-turbo-0613': 'GPT 3.5 Turbo (06/13)',
  'claude-2.0': 'Claude 2.0',
  'llama-2-13b-chat': 'Llama 2 13B Chat',
  'llama-2-7b-chat': 'Llama 2 7B Chat',
  'llama-2-70b-chat': 'Llama 2 70B Chat',
  'wizardlm-70b': 'WizardLM 70B',
  'codellama-34b-instruct': 'CodeLlama 34B Instruct',
  'falcon-180b-chat': 'Falcon 180B Chat',
  'gpt-4-1106-preview': 'GPT 4 (11/06)',
  'mistral-7b-instruct': 'Mistral 7B Instruct',
  'qwen-14b-chat': 'Qwen 14B Chat',
  'zephyr-7b-alpha': 'Zephyr 7B Alpha',
  'gpt-4-0125-preview': 'GPT 4 (01/25)',
  'zephyr-7b-beta': 'Zephyr 7B Beta',
  'openchat-3.5': 'OpenChat 3.5',
  'gpt-3.5-turbo-1106': 'GPT 3.5 Turbo (11/06)',
  'bard-jan-24-gemini-pro': 'Bard (Gemini Pro)',
  'yi-34b-chat': 'Yi 34B Chat',
  'claude-2.1': 'Claude 2.1',
  'mixtral-8x7b-instruct-v0.1': 'Mixtral 8x7B Instruct v0.1',
  'tulu-2-dpo-70b': 'Tulu 2 DPO 70B',
  'starling-lm-7b-alpha': 'Starling LM 7B Alpha',
  'starling-lm-7b-beta': 'Starling LM 7B Beta',
  'pplx-70b-online': 'PPLX 70B Online',
  'gemini-pro': 'Gemini Pro',
  'mistral-medium': 'Mistral Medium',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  'gemini-pro-dev-api': 'Gemini Pro Dev API',
  'gpt-4-turbo-2024-04-09': 'GPT 4 Turbo',
  'mistral-large-2402': 'Mistral Large 2402',
  'qwen1.5-72b-chat': 'Qwen1.5 72B Chat',
  'qwen1.5-32b-chat': 'Qwen1.5 32B Chat',
  'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
  'mistral-next': 'Mistral Next',
  'gemini-1.5-pro-api-0409-preview': 'Gemini 1.5 Pro API 0409 Preview',
  'claude-3-haiku-20240307': 'Claude 3 Haiku',
  'command-r-plus': 'Command R Plus',
  'llama-3-70b-instruct': 'Llama 3 70B Instruct',
  'reka-flash-21b-20240226-online': 'Reka Flash 21B 20240226 Online',
  'command-r': 'Command R',
}
const organizationDict = {
  'gpt-4-0314': 'OpenAI',
  'claude-1': 'Anthropic',
  'vicuna-13b': 'LMSYS',
  'gpt-3.5-turbo-0314': 'OpenAI',
  'claude-instant-1': 'Anthropic',
  'vicuna-33b': 'LMSYS',
  'palm-2': 'Google',
  'koala-13b': 'UC Berkeley',
  'guanaco-33b': 'University of Washington',
  'mpt-30b-chat': 'MosaicML',
  'wizardlm-13b': 'Microsoft',
  'alpaca-13b': 'Stanford',
  'vicuna-7b': 'LMSYS',
  'oasst-pythia-12b': 'Open-Assistant',
  'RWKV-4-Raven-14B': 'BlinkDL',
  'chatglm-6b': 'Tsinghua University',
  'mpt-7b-chat': 'MosaicML',
  'gpt4all-13b-snoozy': 'Nomic AI',
  'gpt-4-0613': 'OpenAI',
  'gpt-3.5-turbo-0613': 'OpenAI',
  'claude-2.0': 'Anthropic',
  'llama-2-13b-chat': 'Meta',
  'llama-2-7b-chat': 'Meta',
  'llama-2-70b-chat': 'Meta',
  'wizardlm-70b': 'Microsoft',
  'codellama-34b-instruct': 'CodeLlama',
  'falcon-180b-chat': 'TII',
  'gpt-4-1106-preview': 'OpenAI',
  'mistral-7b-instruct': 'Mistral AI',
  'qwen-14b-chat': 'Alibaba',
  'zephyr-7b-alpha': 'Hugging Face',
  'gpt-4-0125-preview': 'OpenAI',
  'zephyr-7b-beta': 'Hugging Face',
  'openchat-3.5': 'Openchat',
  'gpt-3.5-turbo-1106': 'OpenAI',
  'bard-jan-24-gemini-pro': 'Google',
  'yi-34b-chat': '	01 AI',
  'claude-2.1': 'Anthropic',
  'mixtral-8x7b-instruct-v0.1': 'Mistral AI',
  'tulu-2-dpo-70b': 'Allen Institute for AI',
  'starling-lm-7b-alpha': 'Berkeley',
  'starling-lm-7b-beta': 'Berkeley',
  'pplx-70b-online': 'Perplexity',
  'gemini-pro': 'Google',
  'mistral-medium': 'Mistral AI',
  'claude-3-opus-20240229': 'Anthropic',
  'gemini-pro-dev-api': 'Google',
  'gpt-4-turbo-2024-04-09': 'OpenAI',
  'mistral-large-2402': 'Mistral AI',
  'qwen1.5-72b-chat': 'Alibaba',
  'qwen1.5-32b-chat': 'Alibaba',
  'claude-3-sonnet-20240229': 'Anthropic',
  'mistral-next': 'Mistral AI',
  'gemini-1.5-pro-api-0409-preview': 'Google',
  'claude-3-haiku-20240307': 'Anthropic',
  'command-r-plus': 'Cohere',
  'llama-3-70b-instruct': 'Meta',
  'reka-flash-21b-20240226-online': 'Reka AI',
  'command-r': 'Cohere',
}

const colorMap = new Map([
  ['OpenAI', 0x74A89B],
  ['Google', 0x4A90E2],
  ['Anthropic', 0xD27556],
  ['Meta', 0x005FD5],
  ['Microsoft', 0x00A1F1],
  ['Alibaba', 0xFF6C00],
  ['Mistral AI', 0xFF7000],
])

const config = new Config({
  idField: 'model',
  stepField: 'time',
  valueField: 'elo_rating',
  xAxisLabel: 'LMSYS Chatbot Arena Elo Ratings',
  maxRetentionTimeSec: 10,
  getStepLabel(step) {
    const date = new Date(step * 1000)
    return timeFormat('%Y-%m-%d')(date)
  },
  swapDurationSec: 0.5,
  valueScaleType: 'from-delta',
  valueScaleDelta: 400,
  y: 0,
  transitionDurationSec: 2,
  labelField: '-',
  topN: 16,
  getColor: (d) => {
    const orig = (organizationDict as any)[d.id] || 'unknown'
    if (colorMap.has(orig)) {
      return colorMap.get(orig)
    }
    const colorStr = colors(orig)
    return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x000000
  },
  getBarInfo: (d) => {
    return `${(organizationDict as any)[d.id]} - ${(nameDict as any)[d.id] || d.id}`
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
  const data = await DataProcessor.processCSV(staticFile('elo_ratings.csv'), config)
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
  const bar = useRef<BarChart>()
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
