import type { ConfigOptions } from '@anichart/core'
import type { DSVRowArray } from 'd3'
import { csvParse } from 'd3'

// ChartSpec 是「可序列化」的图表配置：只存原始类型，方便落 IndexedDB / JSON。
// 真正喂给 @anichart/core 的 ConfigOptions（含 accessor 函数）由 buildConfig() 在运行时派生。

export type ChartKind = 'bar' | 'line'
export type StepMode = 'auto' | 'date' | 'seconds' | 'milliseconds' | 'number'
export type ValueScaleKind = 'adaptive' | 'from-zero' | 'from-min'
export type LineAxis = 'dynamic' | 'fixed' | 'window'

export interface ChartSpec {
  kind: ChartKind
  // 字段映射（列名）
  idField: string
  valueField: string
  stepField: string
  colorField: string // '' 表示跟随 id
  labelField: string // '' 表示跟随 id
  stepMode: StepMode
  // 文案
  title: string
  xAxisLabel: string
  showLabel: boolean
  // 规模 / 时间
  topN: number
  fps: number
  totalDurationSec: number
  transitionDurationSec: number
  valueDecimals: number
  // 动画
  valueScale: ValueScaleKind
  swapAccelBoost: number
  lineAxis: LineAxis
  // 外观
  backgroundColor: string // hex，如 '#0f1115'
}

export function defaultSpec(columns: string[] = []): ChartSpec {
  const g = guessFields(columns)
  return {
    kind: 'bar',
    idField: g.id,
    valueField: g.value,
    stepField: g.step,
    colorField: '',
    labelField: '',
    stepMode: 'auto',
    title: '',
    xAxisLabel: '',
    showLabel: false,
    topN: 12,
    fps: 60,
    totalDurationSec: 30,
    transitionDurationSec: 4,
    valueDecimals: 0,
    valueScale: 'adaptive',
    swapAccelBoost: 2,
    lineAxis: 'dynamic',
    backgroundColor: '#0f1115',
  }
}

// 解析 CSV 文本为 d3 行数组（带 .columns）。直接喂给 DataProcessor.processRows。
export function parseCsv(text: string): DSVRowArray<string> {
  return csvParse(text)
}

const STEP_HINTS = ['date', 'time', 'year', 'month', 'day', 'step', '日期', '时间', '年份']
const VALUE_HINTS = ['value', 'count', 'rating', 'amount', 'total', 'score', 'num', '值', '数量']
const ID_HINTS = ['id', 'name', 'model', 'category', 'label', 'item', '名称', '类别']

function scoreColumn(col: string, hints: string[]): number {
  const lower = col.toLowerCase()
  return hints.some(h => lower.includes(h)) ? 1 : 0
}

// 启发式猜测字段映射：先按列名关键词，再回退到「数值列当 value、其余当 id/step」。
export function guessFields(columns: string[]): { id: string, value: string, step: string } {
  if (columns.length === 0) {
    return { id: 'id', value: 'value', step: 'step' }
  }
  const step = columns.find(c => scoreColumn(c, STEP_HINTS)) ?? columns[columns.length - 1]
  const value = columns.find(c => scoreColumn(c, VALUE_HINTS) && c !== step)
    ?? columns.find(c => c !== step)
    ?? columns[0]
  const id = columns.find(c => scoreColumn(c, ID_HINTS) && c !== step && c !== value)
    ?? columns.find(c => c !== step && c !== value)
    ?? columns[0]
  return { id, value, step }
}

const NUMBER_FMT_CACHE = new Map<number, Intl.NumberFormat>()
function numberFormatter(decimals: number): Intl.NumberFormat {
  let fmt = NUMBER_FMT_CACHE.get(decimals)
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
    NUMBER_FMT_CACHE.set(decimals, fmt)
  }
  return fmt
}

// step 列 → 毫秒时间戳 / 数值的 accessor，按 stepMode 决定如何解释原始值。
function buildStepAccessor(field: string, mode: StepMode): (d: any) => number {
  return (d: any) => {
    const raw = d[field]
    const num = Number(raw)
    switch (mode) {
      case 'seconds': return num * 1000
      case 'milliseconds': return num
      case 'number': return num
      case 'date': return new Date(raw).getTime()
      case 'auto':
      default: {
        // 数字按原样（交给 core 的默认日期/数字解析逻辑判断），否则当日期。
        if (!Number.isNaN(num)) {
          return num
        }
        const t = new Date(raw).getTime()
        return Number.isNaN(t) ? 0 : t
      }
    }
  }
}

// 把可序列化的 ChartSpec 还原成 @anichart/core 的 ConfigOptions（含 accessor）。
export function buildConfig(spec: ChartSpec): ConfigOptions {
  const fmt = numberFormatter(spec.valueDecimals)
  const colorField = spec.colorField || spec.idField
  const labelField = spec.labelField || spec.idField

  const valueScale = spec.valueScale === 'adaptive'
    ? { type: 'adaptive' as const }
    : spec.valueScale === 'from-zero'
      ? { type: 'from-zero' as const }
      : { type: 'from-min' as const }

  return {
    id: spec.idField,
    value: spec.valueField,
    step: buildStepAccessor(spec.stepField, spec.stepMode),
    color: colorField,
    label: labelField,
    getValueLabel: (d: any) => fmt.format(Number(d.value)),
    getTickLabel: (v: number) => fmt.format(v),
    getBarInfo: (d: any) => d.raw?.[labelField] ?? d.id,
    title: spec.title,
    xAxisLabel: spec.xAxisLabel,
    showLabel: spec.showLabel,
    topN: spec.topN,
    fps: spec.fps,
    totalDurationSec: spec.totalDurationSec,
    transitionDurationSec: spec.transitionDurationSec,
    valueScale,
    swap: { algorithm: 'velocity-accel', accelBoost: spec.swapAccelBoost },
    line: { timeAxis: spec.lineAxis },
    backgroundColor: hexToInt(spec.backgroundColor),
    fontFamily: '-apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  }
}

export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16) || 0x0F_11_15
}
