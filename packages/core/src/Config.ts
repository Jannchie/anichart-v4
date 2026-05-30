import type { Data } from './Data'
import dayjs from 'dayjs'
import { colorMap, colors } from './resources'

export type ValueScaleType = 'from-zero' | 'from-min' | 'from-delta' | 'adaptive'

// 扩展时往 union 加成员，并在 DataProcessor 的 SWAP_ALGORITHMS 注册表里注册实现。
//   velocity        —— 纯反馈：blurRank 用「匀减速恰好停在 target」追踪离散 target rank。
//   velocity-accel  —— velocity + 距离自适应加速度：暴涨穿多级时加速度变大、更快收敛，压缩逆序时间，
//                      普通 1-rank 交换不受影响、惯性与 velocity 一致。accelBoost=0 即退化为 velocity。
export type SwapAlgorithmName = 'velocity' | 'velocity-accel'

// 折线图时间轴（X 轴）模式：
//   dynamic —— 跟随「当前活跃线」的时间跨度，右端=当前时刻，线始终填满宽度（赛跑式，默认）。
//   fixed   —— 固定为完整 [起始, 结束]，线从左往右画入，能看绝对位置但常有留白。
//   window  —— 只显示最近一段固定时长（windowRatio）的滚动时间窗，旧历史向左滚出。
export type LineTimeAxisMode = 'dynamic' | 'fixed' | 'window'

// 数据维度取值：传列名（字符串）走默认解析，或传 accessor 自定义派生值。
export type FieldOrAccessor<T> = string | ((d: any, i?: number) => T)

// 值域（X 轴 domain）配置。判别联合：每个 type 只暴露自己相关的参数，消除「设了无关旋钮」的困惑。
//   from-zero  —— domain 下界恒为 0。
//   from-min   —— 下界 = dataMin − (dataMax − dataMin)，屏内首尾差被放大。
//   from-delta —— 下界 = dataMax − delta（固定窗口宽度）。
//   adaptive   —— 软饱和：最后一条相对长度随首尾差距在 [minRatio, maxRatio] 间自适应。
export type ValueScaleConfig
  = | { type: 'from-zero' }
  | { type: 'from-min' }
  | { type: 'from-delta', delta?: number }
  | { type: 'adaptive', minRatio?: number, maxRatio?: number }

// 换位（rank 纵向运动）配置。accelBoost 只对 velocity-accel 生效，结构上挂进来，避免它在顶层「看似全局」。
export interface SwapConfig {
  algorithm?: SwapAlgorithmName
  durationSec?: number // 纵向运动整体节奏标度，越大所有 y 向位移越慢
  accelBoost?: number // 距离自适应加速度系数 a_eff = a·(1 + accelBoost·max(0,|dist|−1))；仅 velocity-accel
}

// 折线图专用配置。
export interface LineConfig {
  timeAxis?: LineTimeAxisMode
  windowRatio?: number // window 模式：时间窗占完整时间跨度的比例
}

// 少改动的精修样式：默认值对绝大多数场景够用，需要时再覆盖，不占顶层。
export interface StyleConfig {
  barInfoPadding?: number
  leftLabelPadding?: number
  valueLabelPadding?: number
  tickNum?: number
  tickLabelFontSize?: number
  borderRadius?: number
}

// 构造 Config 的公开输入。全部可选。
export interface ConfigInput {
  // 数据维度：列名或 accessor。
  id?: FieldOrAccessor<any>
  label?: FieldOrAccessor<any> // 省略时跟随 id
  step?: FieldOrAccessor<number>
  value?: FieldOrAccessor<number>
  color?: FieldOrAccessor<number | undefined>
  image?: string // 取图片用的 raw 列名

  // 文本格式化回调。
  getValueLabel?: (d: any, i?: number) => any
  getValueExtra?: (d: Data) => string
  getBarInfo?: (d: any, i?: number, step?: number) => any
  getStepLabel?: (step: number) => string

  // 时间 / 规模。
  maxRetentionTimeSec?: number
  transitionDurationSec?: number
  totalDurationSec?: number
  fps?: number
  topN?: number

  // 动画。
  swap?: SwapConfig
  line?: LineConfig
  valueScale?: ValueScaleConfig

  // 柱体布局。
  barGap?: number
  barHeight?: number | 'auto' // 'auto'（默认）按可用高度自适应；数字则固定
  barInfoStyle?: 'default' | 'reverse'

  // 显隐 / 文案。
  showStepLabel?: boolean
  showLabel?: boolean
  xAxisLabel?: string
  title?: string

  // 画布 / 几何。
  canvasWidth?: number
  canvasHeight?: number
  backgroundColor?: number
  fontFamily?: string
  x?: number
  y?: number
  width?: number
  height?: number

  // 精修样式覆盖。
  style?: StyleConfig
}

// step 列默认解析：数字原样，否则按日期解析为毫秒时间戳。
function parseStepValue(raw: any): number {
  if (!Number.isNaN(Number(raw))) {
    return Number(raw)
  }
  if (new Date(raw).toString() !== 'Invalid Date') {
    return dayjs(raw).valueOf()
  }
  throw new Error(`step is not a valid date or number: get ${raw}`)
}

// color 默认解析：按 raw[colorField] 查 colorMap / 调色板。
function defaultColorFor(d: any, colorField: string): number | undefined {
  if (colorMap.has(d.raw[colorField])) {
    return colorMap.get(d.raw[colorField])
  }
  const color = colors(d.raw[colorField])
  if (color) {
    return Number.parseInt(color.slice(1), 16)
  }
  return 1_677_721
}

export class Config {
  // ---- 数据维度（accessor 统一入口，渲染/数据层只用这些） ----
  getID: (d: any, i?: number) => any
  getLabel: (d: any, i?: number) => any
  getStep: (d: any, i?: number) => number
  getValue: (d: any, i?: number) => number
  getColor: (d: any, i?: number) => number | undefined
  getValueLabel: (d: any, i?: number) => any
  getValueExtra: (d: Data) => string
  getBarInfo: (d: any, i?: number, step?: number) => any
  getStepLabel: (step: number) => string
  // 内部派生的列名（仅默认解析 / preprocess / 取图用）。
  idField: string
  labelField: string
  stepField: string
  valueField: string
  colorField: string
  imageField: string

  // ---- 时间 / 规模 ----
  maxRetentionTimeSec: number
  transitionDurationSec: number
  totalDurationSec: number
  fps: number
  topN: number

  // ---- 动画（扁平存储，构造时从 swap/line/valueScale 归一） ----
  swapAlgorithm: SwapAlgorithmName
  swapDurationSec: number
  swapAccelBoost: number
  lineTimeAxisMode: LineTimeAxisMode
  lineTimeWindowRatio: number
  valueScaleType: ValueScaleType
  valueScaleDelta: number
  valueScaleMinRatio: number
  valueScaleMaxRatio: number
  valueScaleSmoothing: number // 从 swapDurationSec 自动派生

  // ---- 柱体布局 ----
  barGap: number
  barHeight: number
  autoBarHeight: boolean
  barInfoStyle: 'default' | 'reverse'

  // ---- 显隐 / 文案 ----
  showStepLabel: boolean
  showLabel: boolean
  xAxisLabel: string
  title: string

  // ---- 画布 / 几何 ----
  canvasWidth: number
  canvasHeight: number
  backgroundColor: number
  fontFamily: string
  x: number
  y: number
  width: number
  height: number

  // ---- 精修样式 ----
  barInfoPadding: number
  leftLabelPadding: number
  valueLabelPadding: number
  tickNum: number
  tickLabelFontSize: number
  borderRadius: number

  constructor(input: ConfigInput = {}) {
    // ---- 数据维度：列名 → 默认解析；函数 → 直接用 ----
    const id = input.id ?? 'id'
    this.idField = typeof id === 'string' ? id : 'id'
    this.getID = typeof id === 'function' ? id : (d: any) => d[this.idField]

    // label 省略时跟随 id 列（id 为函数时回退到 'id' 列）。
    const label = input.label ?? (typeof id === 'string' ? id : 'id')
    this.labelField = typeof label === 'string' ? label : ''
    this.getLabel = typeof label === 'function' ? label : (d: any) => d[this.labelField]

    const step = input.step ?? 'step'
    this.stepField = typeof step === 'string' ? step : 'step'
    this.getStep = typeof step === 'function' ? step : (d: any) => parseStepValue(d[this.stepField])

    const value = input.value ?? 'value'
    this.valueField = typeof value === 'string' ? value : 'value'
    this.getValue = typeof value === 'function' ? value : (d: any) => Number(d[this.valueField])

    const color = input.color
    this.colorField = typeof color === 'string' ? color : 'id'
    this.getColor = typeof color === 'function' ? color : (d: any) => defaultColorFor(d, this.colorField)

    this.imageField = input.image ?? 'id'

    this.getValueLabel = input.getValueLabel ?? ((d: Data) => d.value.toFixed(0))
    this.getValueExtra = input.getValueExtra ?? (() => '')
    this.getBarInfo = input.getBarInfo ?? ((d: any) => d.id)
    this.getStepLabel = input.getStepLabel ?? ((step: number) => dayjs(step).format('YYYY-MM-DD'))

    // ---- 时间 / 规模 ----
    this.maxRetentionTimeSec = input.maxRetentionTimeSec ?? 50
    this.transitionDurationSec = input.transitionDurationSec ?? 4
    this.totalDurationSec = input.totalDurationSec ?? 10
    this.fps = input.fps ?? 60
    this.topN = input.topN ?? 20

    // ---- 动画：归一到扁平字段 ----
    const swap = input.swap ?? {}
    this.swapAlgorithm = swap.algorithm ?? 'velocity'
    this.swapDurationSec = swap.durationSec ?? 0.8
    this.swapAccelBoost = swap.accelBoost ?? 2

    const line = input.line ?? {}
    this.lineTimeAxisMode = line.timeAxis ?? 'dynamic'
    this.lineTimeWindowRatio = line.windowRatio ?? 0.35

    const vs = input.valueScale ?? { type: 'from-zero' }
    this.valueScaleType = vs.type
    this.valueScaleDelta = (vs.type === 'from-delta' ? vs.delta : undefined) ?? 300
    this.valueScaleMinRatio = (vs.type === 'adaptive' ? vs.minRatio : undefined) ?? 0.15
    this.valueScaleMaxRatio = (vs.type === 'adaptive' ? vs.maxRatio : undefined) ?? 0.55
    // 平滑窗口从 swapDurationSec 自动派生（与换位节奏对齐），不再单独暴露。
    this.valueScaleSmoothing = Math.max(1, Math.round(this.swapDurationSec * this.fps / 2))

    // ---- 柱体布局 ----
    this.barGap = input.barGap ?? 4
    const barHeight = input.barHeight ?? 'auto'
    this.autoBarHeight = barHeight === 'auto'
    this.barHeight = barHeight === 'auto' ? 24 : barHeight
    this.barInfoStyle = input.barInfoStyle ?? 'default'

    // ---- 显隐 / 文案 ----
    this.showStepLabel = input.showStepLabel ?? true
    this.showLabel = input.showLabel ?? true
    this.xAxisLabel = input.xAxisLabel ?? ''
    this.title = input.title ?? ''

    // ---- 画布 / 几何 ----
    this.canvasWidth = input.canvasWidth ?? 1920
    this.canvasHeight = input.canvasHeight ?? 1080
    this.backgroundColor = input.backgroundColor ?? 0x11_11_11
    this.fontFamily = input.fontFamily ?? 'Berkeley Mono'
    this.x = input.x ?? 10
    this.y = input.y ?? 10
    this.width = input.width ?? this.canvasWidth - 20
    this.height = input.height ?? this.canvasHeight - 20

    // ---- 精修样式 ----
    const style = input.style ?? {}
    this.barInfoPadding = style.barInfoPadding ?? 10
    this.leftLabelPadding = style.leftLabelPadding ?? 5
    this.valueLabelPadding = style.valueLabelPadding ?? 5
    this.tickNum = style.tickNum ?? 8
    this.tickLabelFontSize = style.tickLabelFontSize ?? 24
    this.borderRadius = style.borderRadius ?? 0
  }
}
