import type { Data } from './Data'
import dayjs from 'dayjs'
import { colorMap, colors } from './resources'

export type ValueScaleType = 'from-zero' | 'from-min' | 'from-delta'

interface IConfig {
  canvasWidth: number
  canvasHeight: number
  backgroundColor: number
  fontFamily: string
  idField: string
  getID: (d: any, i: number) => any
  labelField: string
  getLabel: (d: any, i: number) => any
  stepField: string
  getStep: (d: any, i: number) => number
  valueField: string
  getValue: (d: any, i: number) => number
  colorField: string
  getColor: (d: any, i: number) => number | undefined
  getValueExtra: (d: Data) => string
  getValueLabel: (d: any, i: number) => any
  getBarInfo: (d: any, i: number, step: number) => any
  maxRetentionTimeSec: number // 最大暂留时间
  decayRate: number
  transitionDurationSec: number
  totalDurationSec: number
  fps: number
  topN: number
  swapDurationSec: number
  barGap: number
  barInfoPadding: number
  autoBarHeight: boolean
  barHeight: number
  valueScaleType: ValueScaleType
  valueScaleDelta: number
  valueScaleSmoothing: number
  leftLabelPadding: number
  valueLabelPadding: number
  x: number
  y: number
  width: number
  height: number
  showStepLabel: boolean
  showLabel: boolean
  getStepLabel: (step: number) => string
  borderRadius: number
  tickNum: number
  imageField: string
  barInfoStyle: 'default' | 'reverse'
  xAxisLabel: string
  title: string
}

export class Config {
  imageField: string
  canvasWidth: number = 1920
  canvasHeight: number = 1080
  backgroundColor: number = 0x11_11_11
  barInfoStyle: 'default' | 'reverse'
  fontFamily: string
  idField: string = 'id'
  getID: (d: any, i?: number) => any
  labelField: string = 'id'
  getLabel: (d: any, i?: number) => any
  stepField: string = 'step'
  getStep: (d: any, i?: number) => number
  valueField: string = 'value'
  getValue: (d: any, i?: number) => number
  colorField: string = 'id'
  getColor: (d: any, i?: number) => number | undefined
  getValueLabel: (d: any, i?: number) => any
  getBarInfo: (d: any, i?: number, step?: number) => any
  maxRetentionTimeSec: number
  decayRate: number
  transitionDurationSec: number
  totalDurationSec: number
  fps: number
  topN: number
  swapDurationSec: number
  barGap: number
  barHeight: number
  autoBarHeight: boolean = true
  valueScaleType: ValueScaleType
  valueScaleSmoothing: number
  leftLabelPadding: number
  valueLabelPadding: number
  x: number
  y: number
  width!: number
  height!: number
  showStepLabel: boolean
  showLabel: boolean
  getStepLabel: (step: number) => string
  borderRadius: number
  tickNum: number
  valueScaleDelta: number
  getValueExtra: (_: Data) => string
  xAxisLabel: string
  title: string
  barInfoPadding: number
  constructor(config: Partial<IConfig> = {}) {
    this.getID = (d: any) => d[this.idField]
    this.getLabel = (d: any) => d[this.labelField]
    this.getStep = (d: any) => {
      if (!Number.isNaN(Number(d[this.stepField]))) {
        return Number(d[this.stepField])
      }
      if (new Date(d[this.stepField]).toString() !== 'Invalid Date') {
        return dayjs(d[this.stepField]).valueOf()
      }
      throw new Error(`step is not a valid date or number: get ${d[this.stepField]}`)
    }
    this.getValue = (d: any) => Number(d[this.valueField])
    this.colorField = 'id'
    this.getColor = (d: any) => {
      if (colorMap.has(d.raw[this.colorField])) {
        return colorMap.get(d.raw[this.colorField])
      }
      const color = colors(d.raw[this.colorField])
      if (color) {
        return Number.parseInt(color.slice(1), 16)
      }
      return 1_677_721
    }
    this.getValueLabel = (d: Data) => {
      return d.value.toFixed(0)
    }
    this.getValueExtra = (_: Data) => ''
    this.getBarInfo = (d: any) => d.id
    this.maxRetentionTimeSec = 5
    this.decayRate = 1
    this.transitionDurationSec = 0.5
    this.totalDurationSec = 10
    this.barInfoPadding = 10
    this.fps = 60
    this.topN = 20
    this.swapDurationSec = 0.5
    this.barGap = 4
    this.barHeight = 24
    this.valueScaleType = 'from-zero'
    this.valueScaleDelta = 300
    this.valueScaleSmoothing = 0
    this.leftLabelPadding = 5
    this.valueLabelPadding = 5
    this.x = 10
    this.y = 10
    this.showStepLabel = true
    this.showLabel = true
    this.imageField = 'id'
    this.barInfoStyle = 'default'
    this.getStepLabel = (step: number) => dayjs(step).format('YYYY-MM-DD')
    this.borderRadius = 4
    this.fontFamily = 'Berkeley Mono'
    this.tickNum = 8
    this.xAxisLabel = ''
    this.title = ''
    const widthProvided = Object.prototype.hasOwnProperty.call(config, 'width')
    const heightProvided = Object.prototype.hasOwnProperty.call(config, 'height')
    const valueScaleSmoothingProvided = Object.prototype.hasOwnProperty.call(config, 'valueScaleSmoothing')
    Object.assign(this, config)
    if (!valueScaleSmoothingProvided) {
      const smoothingWindow = Math.max(1, Math.round(this.swapDurationSec * this.fps / 2))
      this.valueScaleSmoothing = smoothingWindow
    }
    if (!widthProvided) {
      this.width = this.canvasWidth - 20
    }
    if (!heightProvided) {
      this.height = this.canvasHeight - 20
    }
  }
}
