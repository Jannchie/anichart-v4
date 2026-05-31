import type { ScaleLinear } from 'd3'
import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet, scaleLinear } from 'd3'
import { Container, Graphics, Text } from 'pixi.js'
import { MUTED_LABEL_COLOR, smoothTicksAlpha, TICK_LINE_COLOR, TITLE_FONT_SIZE, TITLE_PADDING } from './utils/chartChrome'
import { measureTextWidth } from './utils/textMetrics'

const DEFAULT_X_AXIS_TICK_HEIGHT = 32

interface SeriesPoint {
  frameIndex: number
  data: RankedData
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

// 折线图纵轴上下各留的空白比例（相对当前 domain span），让线不贴边。
const VALUE_SCALE_PADDING_RATIO = 0.06

class LineSeries extends Container {
  private readonly line: Graphics
  private readonly marker: Graphics
  private readonly labelNode: Text
  private readonly color: number
  private readonly labelText: string
  private readonly points: SeriesPoint[]
  private readonly frameIndices: number[]
  private readonly activePointBuffer: SeriesPoint[] = []
  private readonly xBuffer: number[] = []
  private readonly yBuffer: number[] = []

  constructor(options: { points: SeriesPoint[], color: number, label: string, fontFamily: string }) {
    super()
    this.points = options.points.filter(point => Number.isFinite(point.data.value))
    this.frameIndices = this.points.map(point => point.frameIndex)
    this.color = options.color
    this.labelText = options.label

    this.line = new Graphics()
    this.marker = new Graphics()
    this.labelNode = new Text({
      text: this.labelText,
      style: {
        fontFamily: options.fontFamily,
        fontSize: 22,
        fill: this.color,
      },
    })
    this.labelNode.anchor.set(0, 0.5)

    this.marker.circle(0, 0, 5).fill({ color: this.color, alpha: 0.9 })
    this.marker.visible = false
    this.marker.renderable = false

    this.addChild(this.line, this.marker, this.labelNode)
  }

  private findLastActiveIndex(frameIndex: number) {
    let low = 0
    let high = this.frameIndices.length - 1
    let result = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (this.frameIndices[mid] <= frameIndex) {
        result = mid
        low = mid + 1
      }
      else {
        high = mid - 1
      }
    }
    return result
  }

  update(
    frameIndex: number,
    getX: (point: SeriesPoint) => number,
    valueScale: ScaleLinear<number, number>,
    plotHeight: number,
    options: { showLabel: boolean, topN: number, plotWidth: number },
  ) {
    const { showLabel, topN, plotWidth } = options

    const lastActiveIndex = this.findLastActiveIndex(frameIndex)
    // 只把 alpha>0 的点纳入折线：跳过未入场 / 已离场 / 掉出 topN 的停车点
    // （它们的 value=baseline，否则会画成一条贴底的水平线）。
    let count = 0
    for (let i = 0; i <= lastActiveIndex; i += 1) {
      const point = this.points[i]
      if (point.data.alpha <= 0) {
        continue
      }
      const rawX = getX(point)
      // x<0：早于当前时间窗左端的旧点（仅 window 模式会出现）→ 丢弃，让线从窗内起画。
      if (rawX < 0) {
        continue
      }
      const x = Math.min(rawX, plotWidth)
      const valueRatio = clamp01(valueScale(point.data.value))
      const y = plotHeight * (1 - valueRatio)
      this.activePointBuffer[count] = point
      this.xBuffer[count] = x
      this.yBuffer[count] = y
      count += 1
    }
    this.activePointBuffer.length = count
    this.xBuffer.length = count
    this.yBuffer.length = count

    if (count === 0) {
      this.renderable = false
      this.marker.visible = false
      this.marker.renderable = false
      this.labelNode.visible = false
      this.labelNode.renderable = false
      return
    }

    this.renderable = true
    this.marker.visible = true
    this.marker.renderable = true
    this.line.clear()
    this.line.setStrokeStyle({
      width: 3,
      color: this.color,
      join: 'round',
      cap: 'round',
      alpha: 0.9,
    })

    const firstX = this.xBuffer[0]
    const firstY = this.yBuffer[0]
    if (count === 1) {
      this.line.moveTo(firstX, firstY)
    }
    else {
      this.line.moveTo(firstX, firstY)
      for (let i = 0; i < count - 1; i += 1) {
        const currentX = this.xBuffer[i]
        const currentY = this.yBuffer[i]
        const nextX = this.xBuffer[i + 1]
        const nextY = this.yBuffer[i + 1]
        if (i === count - 2) {
          this.line.quadraticCurveTo(currentX, currentY, nextX, nextY)
        }
        else {
          const midX = (currentX + nextX) / 2
          const midY = (currentY + nextY) / 2
          this.line.quadraticCurveTo(currentX, currentY, midX, midY)
        }
      }
    }
    this.line.stroke()

    const lastIndex = count - 1
    const lastPoint = this.activePointBuffer[lastIndex]
    const lastX = this.xBuffer[lastIndex]
    const lastY = this.yBuffer[lastIndex]
    // 整条线按「当前帧」该 id 的 alpha 淡入/淡出：入场 0→1、掉出 topN / 出场 1→0，
    // 停车后 alpha=0 自然隐藏（几何冻结在最后一个真实点，不可见）。
    const currentPoint = this.points[lastActiveIndex]
    this.alpha = clamp01(currentPoint?.data.alpha ?? 1)

    this.marker.position.set(lastX, lastY)

    this.labelNode.visible = showLabel
    this.labelNode.renderable = showLabel
    if (showLabel) {
      const labelOffset = 8
      const labelX = clamp(lastX + labelOffset, 0, Math.max(plotWidth - this.labelNode.width, 0))
      this.labelNode.position.set(labelX, lastY)
    }

    this.zIndex = Math.round((topN - lastPoint.data.blurRank) * 100)
  }
}

export class LineChart extends Container {
  private readonly data: RankedData[][]
  private readonly config: Config
  private readonly frameValueScales: ScaleLinear<number, number>[] = []
  private readonly frameIdSets: InternSet<string>[] = []
  private readonly frameMaxSteps: Array<number | undefined> = []
  private readonly ticksAlphaMap: Map<number, number[]> = new Map()
  private readonly ticksComponentMap: Map<number, Container> = new Map()
  private readonly tickLineMap: Map<number, Graphics> = new Map()
  private readonly seriesMap: Map<string, LineSeries> = new Map()
  private readonly seriesLayer: Container
  private readonly yAxisTickContainer: Container
  private readonly plotArea: Container
  private readonly yAxisLine: Graphics
  private readonly xAxisLine: Graphics
  private readonly currentMarker: Graphics
  private readonly stepLabel: Text
  private readonly titleLabel: Text
  private readonly xAxisLabel: Text
  private readonly xAxisTickContainer: Container
  private readonly startTickLabel: Text
  private readonly endTickLabel: Text
  private readonly textWidthCache = new Map<string, number>()
  private readonly yAxisLabelPadding = 16
  private readonly xAxisLabelPadding = 10
  private readonly axisTickOffset = 8
  private readonly rightPadding = 48
  private readonly xAxisTickHeight: number

  private tickLabelHeight = 0
  private tickLabelMaxWidth = 0
  private plotWidth = 0
  private plotHeight = 0
  private leftMargin = 0
  private axisBaselineY = 0

  // 每帧的 X(时间) scale，domain 为 step 区间、range 归一化到 [0,1]（× plotWidth 得像素）。
  // 三种 lineTimeAxisMode 在 computeXScales 里产出不同的 domain。
  private readonly frameXScales: ScaleLinear<number, number>[] = []
  private readonly stepDomain: [number, number]

  constructor(data: RankedData[][], config: Config) {
    super()
    this.data = data
    this.config = config
    this.position.set(config.x, config.y)

    const flatSteps = data.flat().map(d => d.step).filter(isFiniteNumber)
    const [minStepRaw, maxStepRaw] = extent(flatSteps)
    const defaultIndexDomain: [number, number] = [0, Math.max(data.length - 1, 1)]
    let stepDomain: [number, number]
    if (isFiniteNumber(minStepRaw) && isFiniteNumber(maxStepRaw)) {
      const safeMax = minStepRaw === maxStepRaw ? minStepRaw + 1 : maxStepRaw
      stepDomain = [minStepRaw, safeMax]
    }
    else {
      stepDomain = defaultIndexDomain
    }
    this.stepDomain = stepDomain

    this.yAxisTickContainer = new Container()
    this.seriesLayer = new Container()
    this.seriesLayer.sortableChildren = true
    this.plotArea = new Container()
    this.yAxisLine = new Graphics()
    this.xAxisLine = new Graphics()
    this.currentMarker = new Graphics()
    this.xAxisTickContainer = new Container()

    this.xAxisLabel = new Text({
      text: config.xAxisLabel,
      style: {
        fontSize: 32,
        fill: MUTED_LABEL_COLOR,
        fontFamily: config.fontFamily,
      },
    })

    const showTitle = Boolean(config.title?.trim())
    this.titleLabel = new Text({
      text: config.title,
      style: {
        fontSize: TITLE_FONT_SIZE,
        fill: 0xFF_FF_FF,
        fontFamily: config.fontFamily,
        fontWeight: 'bold',
        align: 'center',
      },
    })

    this.stepLabel = new Text({
      style: {
        fontSize: 48,
        fill: 0xFF_FF_FF,
        fontFamily: config.fontFamily,
      },
    })

    const xTickStyle = {
      fontSize: config.tickLabelFontSize,
      fill: MUTED_LABEL_COLOR,
      fontFamily: config.fontFamily,
    }
    this.startTickLabel = new Text({ style: xTickStyle })
    this.endTickLabel = new Text({ style: xTickStyle })
    this.startTickLabel.anchor.set(0.5, 0)
    this.endTickLabel.anchor.set(0.5, 0)
    this.xAxisTickContainer.addChild(this.startTickLabel, this.endTickLabel)

    this.collectFrameStats()
    this.computeXScales()
    this.prepareTickComponents()
    this.applyTickSmoothing()

    const hasXAxisLabel = Boolean(config.xAxisLabel?.trim())
    const xAxisLabelPaddingUsed = hasXAxisLabel ? this.xAxisLabelPadding : 0
    const xAxisLabelHeight = hasXAxisLabel ? this.xAxisLabel.height : 0
    this.xAxisTickHeight = Math.max(DEFAULT_X_AXIS_TICK_HEIGHT, Math.ceil(config.tickLabelFontSize * 1.6))
    this.leftMargin = this.tickLabelMaxWidth + this.yAxisLabelPadding

    const titleFontSize = typeof this.titleLabel.style.fontSize === 'number'
      ? this.titleLabel.style.fontSize
      : Number.parseFloat(String(this.titleLabel.style.fontSize ?? 0)) || 0
    const titleOffset = showTitle ? Math.max(this.titleLabel.height, titleFontSize) + TITLE_PADDING : 0

    this.plotWidth = Math.max(config.width - this.leftMargin - this.rightPadding, 0)
    this.plotHeight = Math.max(config.height - titleOffset - this.xAxisTickHeight - xAxisLabelHeight - xAxisLabelPaddingUsed, 0)
    this.axisBaselineY = titleOffset + this.plotHeight

    this.titleLabel.anchor.set(0.5, 0)
    this.titleLabel.position.set(config.width / 2, 0)
    this.titleLabel.visible = showTitle
    this.titleLabel.renderable = showTitle

    this.plotArea.position.set(this.leftMargin, titleOffset)
    this.plotArea.addChild(this.yAxisTickContainer, this.seriesLayer, this.yAxisLine, this.xAxisLine, this.currentMarker)

    this.xAxisTickContainer.position.set(this.leftMargin, this.axisBaselineY + this.axisTickOffset)
    this.startTickLabel.position.set(0, 0)
    this.endTickLabel.position.set(this.plotWidth, 0)

    this.xAxisLabel.anchor.set(0.5, 0)
    this.xAxisLabel.position.set(this.leftMargin + this.plotWidth / 2, this.axisBaselineY + this.axisTickOffset + this.xAxisTickHeight)
    this.xAxisLabel.visible = hasXAxisLabel
    this.xAxisLabel.renderable = hasXAxisLabel

    if (config.showStepLabel) {
      this.stepLabel.anchor.set(1, 1)
      this.stepLabel.position.set(config.width, config.height)
    }
    else {
      this.stepLabel.renderable = false
    }

    this.addChild(this.titleLabel)
    this.addChild(this.plotArea)
    this.addChild(this.xAxisTickContainer)
    this.addChild(this.xAxisLabel)
    this.addChild(this.stepLabel)

    this.populateSeries()
    this.refreshAxisGuides()
    const initialScale = this.frameXScales[0]
    if (initialScale) {
      const [lo, hi] = initialScale.domain()
      this.setXAxisLabels(lo, hi)
    }
  }

  update(frameIndex: number) {
    if (frameIndex >= this.data.length) {
      return
    }
    const frameData = this.data[frameIndex]
    let valueScale = this.frameValueScales[frameIndex]
    if (!valueScale) {
      // 兜底（正常路径下 collectFrameStats 已预填）：下界看稳定点、上界看渐入点。
      const [min] = extent(frameData.filter(d => d.alpha >= 1), d => d.value)
      const [, max] = extent(frameData.filter(d => d.alpha > 0), d => d.value)
      valueScale = this.buildValueScale(min ?? 0, max ?? 1)
      this.frameValueScales[frameIndex] = valueScale
    }

    for (const [tick, alphaList] of this.ticksAlphaMap.entries()) {
      const tickContainer = this.ticksComponentMap.get(tick)
      if (!tickContainer) {
        continue
      }
      tickContainer.alpha = alphaList[frameIndex] ?? 0
      const ratio = clamp01(valueScale(tick))
      const y = (1 - ratio) * this.plotHeight
      tickContainer.position.set(0, y)
    }

    const xScale = this.frameXScales[frameIndex] ?? this.frameXScales.at(-1)

    for (const series of this.seriesMap.values()) {
      series.update(
        frameIndex,
        point => this.getXPosition(point, xScale),
        valueScale,
        this.plotHeight,
        {
          showLabel: this.config.showLabel,
          topN: this.config.topN,
          plotWidth: this.plotWidth,
        },
      )
    }

    this.updateCurrentMarker(frameIndex, xScale)
    if (xScale) {
      const [loStep, hiStep] = xScale.domain()
      this.setXAxisLabels(loStep, hiStep)
    }

    if (this.config.showStepLabel) {
      const currentStep = this.frameMaxSteps[frameIndex]
      this.stepLabel.text = currentStep === undefined ? '' : this.config.getStepLabel(currentStep)
    }
  }

  // 折线图专用的紧凑纵轴：domain 直接铺到 [min, max] 并上下各留 padding，让数据填满纵向空间。
  // 不走 BarChart 的 adaptive 软饱和（那是为「柱长从轴底起算」设计的，会把下界拉到数据以下、
  // 把折线挤到顶部一小条）。
  private buildValueScale(min: number, max: number): ScaleLinear<number, number> {
    let lo = Number.isFinite(min) ? min : 0
    let hi = Number.isFinite(max) ? max : 1
    if (lo > hi) {
      [lo, hi] = [hi, lo]
    }
    const span = hi - lo
    const pad = span > 0 ? span * VALUE_SCALE_PADDING_RATIO : (Math.abs(hi) * 0.01 || 1)
    return scaleLinear().domain([lo - pad, hi + pad]).range([0, 1])
  }

  // 把 step 区间映射到 [0,1]；退化（lo>=hi，如首帧只有单一时刻）时给极小跨度，所有点落到左端。
  private buildStepScale(lo: number, hi: number): ScaleLinear<number, number> {
    const safeHi = hi > lo ? hi : lo + 1
    return scaleLinear().domain([lo, safeHi]).range([0, 1])
  }

  // 按 lineTimeAxisMode 产出每帧的时间轴 scale：
  //   fixed   —— 全程固定 [gMin, gMax]。
  //   window  —— 右端=当前步，左端=当前步−窗宽（窗宽=lineTimeWindowRatio×全程跨度），左端不越过 gMin。
  //   dynamic —— 右端=当前步（前沿贴右边缘），左端=当前活跃线里「最早已绘制步」的平滑值（与纵轴对称）。
  private computeXScales() {
    const T = this.data.length
    const mode = this.config.lineTimeAxisMode
    const [gMin, gMax] = this.stepDomain
    const indexMax = Math.max(T - 1, 1)
    const stepAt = (f: number) => {
      const cur = this.frameMaxSteps[f]
      return isFiniteNumber(cur) ? cur : gMin + (gMax - gMin) * (f / indexMax)
    }

    if (mode === 'fixed') {
      const scale = this.buildStepScale(gMin, gMax)
      for (let f = 0; f < T; f += 1) {
        this.frameXScales[f] = scale
      }
      return
    }

    if (mode === 'window') {
      const windowSpan = Math.max((gMax - gMin) * this.config.lineTimeWindowRatio, 1e-9)
      for (let f = 0; f < T; f += 1) {
        const hi = stepAt(f)
        const lo = Math.max(gMin, hi - windowSpan)
        this.frameXScales[f] = this.buildStepScale(lo, hi)
      }
      return
    }

    // dynamic：每条序列记录它「首个 alpha>0（已绘制）步」；每帧左端取当前活跃序列里最早的那个。
    const firstDrawnStep = new Map<string, number>()
    const rawMin: number[] = Array.from<number>({ length: T }).fill(gMin)
    const rawMax: number[] = Array.from<number>({ length: T }).fill(gMin)
    for (let f = 0; f < T; f += 1) {
      const cur = stepAt(f)
      let lo = Number.POSITIVE_INFINITY
      for (const item of this.data[f]) {
        if (item.alpha <= 0) {
          continue
        }
        let first = firstDrawnStep.get(item.id)
        if (first === undefined) {
          first = isFiniteNumber(item.step) ? item.step : cur
          firstDrawnStep.set(item.id, first)
        }
        if (first < lo) {
          lo = first
        }
      }
      rawMin[f] = Number.isFinite(lo) ? lo : cur
      rawMax[f] = cur
    }
    // 平滑左端，减少入场/掉榜时左边界跳动；右端保持精确=当前步。min(平滑, 原始) 保证不裁切已绘制点。
    const smoothingRadius = Math.max(0, Math.floor(this.config.valueScaleSmoothing))
    let smoothedMin = [...rawMin]
    if (smoothingRadius > 0 && T > 1) {
      smoothedMin = [...blur([...rawMin], smoothingRadius) as Float64Array]
    }
    for (let f = 0; f < T; f += 1) {
      const sMin = Number.isNaN(smoothedMin[f]) ? rawMin[f] : smoothedMin[f]
      this.frameXScales[f] = this.buildStepScale(Math.min(sMin, rawMin[f]), rawMax[f])
    }
  }

  private collectFrameStats() {
    const T = this.data.length
    const frameMinValues: number[] = Array.from<number>({ length: T }).fill(0)
    const frameMaxValues: number[] = Array.from<number>({ length: T }).fill(0)

    // 动态纵轴：每帧的 domain 只汇总「当前活跃」(alpha>0) 序列「已绘制真实数据」的 min/max。
    //   - prefMin/prefMax：每条序列对其 alpha>=1 的真实点累计前缀极值（含入场以来的历史），
    //     保证已经画出的折线永远落在框内、不被裁切；
    //   - 只取当前活跃序列 → 未入场 / 已出场 / 掉出 topN 的序列不再钉住值域，
    //     纵轴随榜单上移、收紧，不会"感觉固定"；
    //   - 入场/出场 ramp（alpha∈(0,1)）向 baseline 俯冲，不计入 domain（否则又把下界拉穿底）。
    const prefMin = new Map<string, number>()
    const prefMax = new Map<string, number>()

    for (let f = 0; f < T; f += 1) {
      const frame = this.data[f]
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      for (const item of frame) {
        if (item.alpha >= 1 && Number.isFinite(item.value)) {
          const pmin = prefMin.get(item.id)
          prefMin.set(item.id, pmin === undefined ? item.value : Math.min(pmin, item.value))
          const pmax = prefMax.get(item.id)
          prefMax.set(item.id, pmax === undefined ? item.value : Math.max(pmax, item.value))
        }
        if (item.alpha > 0) {
          const pmin = prefMin.get(item.id)
          const pmax = prefMax.get(item.id)
          if (pmin !== undefined && pmin < lo) {
            lo = pmin
          }
          if (pmax !== undefined && pmax > hi) {
            hi = pmax
          }
        }
      }
      if (!Number.isFinite(lo)) {
        lo = 0
        hi = 0
      }
      frameMinValues[f] = lo
      frameMaxValues[f] = hi
      this.frameIdSets[f] = new InternSet(frame.map(item => item.id))
      // 同帧所有 item 共享 step（fillRank 写入），取首个即可。
      this.frameMaxSteps[f] = frame.length > 0 ? frame[0].step : undefined
    }

    const smoothingRadius = Math.max(0, Math.floor(this.config.valueScaleSmoothing))
    let smoothedMinValues = [...frameMinValues]
    let smoothedMaxValues = [...frameMaxValues]
    if (smoothingRadius > 0 && T > 1) {
      smoothedMinValues = [...blur([...frameMinValues], smoothingRadius) as Float64Array]
      smoothedMaxValues = [...blur([...frameMaxValues], smoothingRadius) as Float64Array]
    }
    for (let f = 0; f < T; f += 1) {
      const rawMin = frameMinValues[f]
      const rawMax = frameMaxValues[f]
      const sMin = Number.isNaN(smoothedMinValues[f]) ? rawMin : smoothedMinValues[f]
      const sMax = Number.isNaN(smoothedMaxValues[f]) ? rawMax : smoothedMaxValues[f]
      // 平滑只用来让纵轴变化更顺；最终 domain 仍须包住当帧真实数据，避免折线被裁切。
      const domainMin = Math.min(sMin, rawMin)
      const domainMax = Math.max(sMax, rawMax)
      this.frameValueScales[f] = this.buildValueScale(domainMin, domainMax)
    }
  }

  private prepareTickComponents() {
    const tickSet = new InternSet<number>()
    for (const [frameIndex] of this.data.entries()) {
      const scale = this.frameValueScales[frameIndex]
      const ticks = scale.ticks(this.config.tickNum)
      for (const tick of ticks) {
        if (tickSet.has(tick)) {
          const alphaList = this.ticksAlphaMap.get(tick)!
          alphaList[frameIndex] = 1
          continue
        }
        tickSet.add(tick)
        const alphaList = Array.from<number>({ length: this.data.length }).fill(0)
        alphaList[frameIndex] = 1
        this.ticksAlphaMap.set(tick, alphaList)

        const tickText = new Text({
          text: tick.toString(),
          style: {
            fontSize: this.config.tickLabelFontSize,
            fill: MUTED_LABEL_COLOR,
            fontFamily: this.config.fontFamily,
          },
        })
        tickText.anchor.set(1, 0.5)
        const tickLine = new Graphics()
        tickLine.setStrokeStyle({
          width: 1,
          color: TICK_LINE_COLOR,
          alpha: 0.4,
        })

        const tickContainer = new Container()
        tickLine.position.set(0, 0)
        tickText.position.set(-this.yAxisLabelPadding, 0)
        tickContainer.addChild(tickLine, tickText)
        this.yAxisTickContainer.addChild(tickContainer)
        this.ticksComponentMap.set(tick, tickContainer)
        this.tickLineMap.set(tick, tickLine)

        const tickWidth = measureTextWidth(tickText.text ?? '', tickText.style, this.textWidthCache)
        this.tickLabelMaxWidth = Math.max(this.tickLabelMaxWidth, tickWidth)
        this.tickLabelHeight = Math.max(this.tickLabelHeight, tickText.height)
      }
    }
  }

  private applyTickSmoothing() {
    smoothTicksAlpha(this.ticksAlphaMap, this.config)
  }

  private populateSeries() {
    const seriesPointsMap = new Map<string, SeriesPoint[]>()
    for (const [frameIndex, frame] of this.data.entries()) {
      for (const item of frame) {
        let list = seriesPointsMap.get(item.id)
        if (!list) {
          list = []
          seriesPointsMap.set(item.id, list)
        }
        list.push({ frameIndex, data: item })
      }
    }

    for (const [id, points] of seriesPointsMap.entries()) {
      points.sort((a, b) => a.frameIndex - b.frameIndex)
      const firstPoint = points[0]
      const sample = firstPoint?.data
      if (!sample) {
        continue
      }
      const color = this.config.getColor(sample)
      const label = sample.label ?? sample.id
      const series = new LineSeries({
        points,
        color: color ?? 0xFF_FF_FF,
        label,
        fontFamily: this.config.fontFamily,
      })
      this.seriesLayer.addChild(series)
      this.seriesMap.set(id, series)
    }
  }

  private refreshAxisGuides() {
    for (const graphics of this.tickLineMap.values()) {
      graphics.clear()
      graphics.setStrokeStyle({
        width: 1,
        color: TICK_LINE_COLOR,
        alpha: 0.4,
      })
      graphics.moveTo(0, 0)
      graphics.lineTo(this.plotWidth, 0)
      graphics.stroke()
    }

    this.yAxisLine.clear()
    this.yAxisLine.setStrokeStyle({
      width: 1,
      color: 0x66_66_66,
    })
    this.yAxisLine.moveTo(0, 0)
    this.yAxisLine.lineTo(0, this.plotHeight)
    this.yAxisLine.stroke()

    this.xAxisLine.clear()
    this.xAxisLine.setStrokeStyle({
      width: 1,
      color: 0x66_66_66,
    })
    this.xAxisLine.moveTo(0, this.plotHeight)
    this.xAxisLine.lineTo(this.plotWidth, this.plotHeight)
    this.xAxisLine.stroke()
  }

  private updateCurrentMarker(frameIndex: number, xScale: ScaleLinear<number, number>) {
    const frame = this.data[frameIndex]
    const currentStep = this.frameMaxSteps[frameIndex] ?? frame[0]?.step
    const markerX = isFiniteNumber(currentStep) && xScale
      ? this.clampToPlot(xScale(currentStep) * this.plotWidth)
      : this.clampToPlot((frameIndex / Math.max(this.data.length - 1, 1)) * this.plotWidth)

    this.currentMarker.clear()
    this.currentMarker.setStrokeStyle({
      width: 1,
      color: 0xFF_FF_FF,
      alpha: 0.35,
    })
    this.currentMarker.moveTo(markerX, 0)
    this.currentMarker.lineTo(markerX, this.plotHeight)
    this.currentMarker.stroke()
  }

  private setXAxisLabels(loStep: number, hiStep: number) {
    this.startTickLabel.text = isFiniteNumber(loStep) ? this.config.getStepLabel(loStep) : ''
    this.endTickLabel.text = isFiniteNumber(hiStep) ? this.config.getStepLabel(hiStep) : ''
    this.endTickLabel.position.set(this.plotWidth, 0)
  }

  // 返回未裁剪的像素 X（可能 <0：早于当帧时间窗左端的点）。LineSeries 据此丢弃窗外的旧点。
  private getXPosition(point: SeriesPoint, xScale: ScaleLinear<number, number>) {
    const step = point.data.step
    if (xScale && isFiniteNumber(step)) {
      return xScale(step) * this.plotWidth
    }
    const idxRatio = point.frameIndex / Math.max(this.data.length - 1, 1)
    return idxRatio * this.plotWidth
  }

  private clampToPlot(value: number) {
    return clamp(value, 0, this.plotWidth)
  }
}
