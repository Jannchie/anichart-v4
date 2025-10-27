import type { ScaleLinear } from 'd3'
import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet, scaleLinear } from 'd3'
import { CanvasTextMetrics, Container, Graphics, Text } from 'pixi.js'

const TITLE_FONT_SIZE = 36
const TITLE_PADDING = 24
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

function getValueScale(type: string, min?: number, max?: number, delta: number = 1000) {
  const safeMin = min ?? 0
  const safeMax = max ?? 1
  if (type === 'from-zero') {
    return scaleLinear().domain([0, safeMax]).range([0, 1])
  }
  if (type === 'from-min') {
    return scaleLinear().domain([safeMin - (safeMax - safeMin), safeMax]).range([0, 1])
  }
  if (type === 'from-delta') {
    return scaleLinear().domain([safeMax - delta, safeMax]).range([0, 1])
  }
  throw new Error('Unknown value scale type')
}

class LineSeries extends Container {
  private readonly line: Graphics
  private readonly marker: Graphics
  private readonly labelNode: Text
  private readonly color: number
  private readonly labelText: string
  private readonly points: SeriesPoint[]

  constructor(options: { points: SeriesPoint[], color: number, label: string, fontFamily: string }) {
    super()
    this.points = options.points
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

    this.addChild(this.line, this.marker, this.labelNode)
  }

  update(
    frameIndex: number,
    getX: (point: SeriesPoint) => number,
    valueScale: ScaleLinear<number, number>,
    plotHeight: number,
    options: { showLabel: boolean, topN: number, plotWidth: number },
  ) {
    const { showLabel, topN, plotWidth } = options

    const activePoints = this.points
      .filter(point => point.frameIndex <= frameIndex && point.data.alpha > 0)
      .toSorted((a, b) => a.frameIndex - b.frameIndex)

    if (activePoints.length === 0) {
      this.renderable = false
      return
    }

    this.renderable = true
    this.line.clear()
    this.line.setStrokeStyle({
      width: 3,
      color: this.color,
      join: 'round',
      cap: 'round',
      alpha: 0.9,
    })

    const positions: Array<{ x: number, y: number, point: SeriesPoint }> = []
    for (const point of activePoints) {
      const rawX = getX(point)
      const x = clamp(rawX, 0, plotWidth)
      const valueRatio = clamp01(valueScale(point.data.value))
      const y = plotHeight * (1 - valueRatio)
      positions.push({ x, y, point })
    }

    if (positions.length === 1) {
      const only = positions[0]
      this.line.moveTo(only.x, only.y)
    }
    else if (positions.length > 1) {
      this.line.moveTo(positions[0].x, positions[0].y)
      for (let i = 0; i < positions.length - 1; i += 1) {
        const current = positions[i]
        const next = positions[i + 1]
        if (i === positions.length - 2) {
          this.line.quadraticCurveTo(current.x, current.y, next.x, next.y)
        }
        else {
          const midX = (current.x + next.x) / 2
          const midY = (current.y + next.y) / 2
          this.line.quadraticCurveTo(current.x, current.y, midX, midY)
        }
      }
    }
    this.line.stroke()

    const lastPosition = positions.at(-1)!
    const seriesAlpha = clamp01(lastPosition.point.data.alpha)
    this.alpha = seriesAlpha

    this.marker.clear()
    this.marker.beginFill(this.color, 0.9)
    this.marker.drawCircle(0, 0, 5)
    this.marker.endFill()
    this.marker.position.set(lastPosition.x, lastPosition.y)

    this.labelNode.text = this.labelText
    this.labelNode.visible = showLabel
    this.labelNode.renderable = showLabel
    if (showLabel) {
      const labelOffset = 8
      const labelX = clamp(lastPosition.x + labelOffset, 0, Math.max(plotWidth - this.labelNode.width, 0))
      this.labelNode.position.set(labelX, lastPosition.y)
    }

    this.zIndex = Math.round((topN - lastPosition.point.data.blurRank) * 100)
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

  private readonly stepDomain: [number, number]
  private readonly indexDomain: [number, number]
  private readonly xScale: ScaleLinear<number, number>
  private readonly indexScale: ScaleLinear<number, number>

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
    this.indexDomain = defaultIndexDomain

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
        fill: 0xAA_AA_AA,
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
      fontSize: 24,
      fill: 0xAA_AA_AA,
      fontFamily: config.fontFamily,
    }
    this.startTickLabel = new Text({ style: xTickStyle })
    this.endTickLabel = new Text({ style: xTickStyle })
    this.startTickLabel.anchor.set(0.5, 0)
    this.endTickLabel.anchor.set(0.5, 0)
    this.xAxisTickContainer.addChild(this.startTickLabel, this.endTickLabel)

    this.collectFrameStats()
    this.prepareTickComponents()
    this.applyTickSmoothing()

    const hasXAxisLabel = Boolean(config.xAxisLabel?.trim())
    const xAxisLabelPaddingUsed = hasXAxisLabel ? this.xAxisLabelPadding : 0
    const xAxisLabelHeight = hasXAxisLabel ? this.xAxisLabel.height : 0
    this.xAxisTickHeight = DEFAULT_X_AXIS_TICK_HEIGHT
    this.leftMargin = this.tickLabelMaxWidth + this.yAxisLabelPadding

    const titleFontSize = typeof this.titleLabel.style.fontSize === 'number'
      ? this.titleLabel.style.fontSize
      : Number.parseFloat(String(this.titleLabel.style.fontSize ?? 0)) || 0
    const titleOffset = showTitle ? Math.max(this.titleLabel.height, titleFontSize) + TITLE_PADDING : 0

    this.plotWidth = Math.max(config.width - this.leftMargin - this.rightPadding, 0)
    this.plotHeight = Math.max(config.height - titleOffset - this.xAxisTickHeight - xAxisLabelHeight - xAxisLabelPaddingUsed, 0)
    this.axisBaselineY = titleOffset + this.plotHeight

    this.xScale = scaleLinear().domain(this.stepDomain).range([0, this.plotWidth])
    this.indexScale = scaleLinear().domain(this.indexDomain).range([0, this.plotWidth])

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
    this.updateAxisTickTexts()
  }

  update(frameIndex: number) {
    if (frameIndex >= this.data.length) {
      return
    }
    const frameData = this.data[frameIndex]
    let valueScale = this.frameValueScales[frameIndex]
    if (!valueScale) {
      const [min, max] = extent(frameData, d => d.value)
      valueScale = getValueScale(this.config.valueScaleType, min, max, this.config.valueScaleDelta)
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

    for (const series of this.seriesMap.values()) {
      series.update(
        frameIndex,
        point => this.getXPosition(point),
        valueScale,
        this.plotHeight,
        {
          showLabel: this.config.showLabel,
          topN: this.config.topN,
          plotWidth: this.plotWidth,
        },
      )
    }

    this.updateCurrentMarker(frameIndex)

    if (this.config.showStepLabel) {
      const currentStep = this.frameMaxSteps[frameIndex]
      this.stepLabel.text = currentStep === undefined ? '' : this.config.getStepLabel(currentStep)
    }
  }

  private collectFrameStats() {
    const frameMinValues: number[] = []
    const frameMaxValues: number[] = []

    for (const [frameIndex, frame] of this.data.entries()) {
      const [min, max] = extent(frame, this.config.getValue)
      const safeMin = Number.isFinite(min) ? Number(min) : 0
      const safeMax = Number.isFinite(max) ? Number(max) : 0
      frameMinValues[frameIndex] = safeMin
      frameMaxValues[frameIndex] = safeMax
      this.frameValueScales[frameIndex] = getValueScale(this.config.valueScaleType, safeMin, safeMax, this.config.valueScaleDelta)
      this.frameIdSets[frameIndex] = new InternSet(frame.map(item => item.id))
      if (frame.length > 0) {
        let maxStep = frame[0].step
        for (let idx = 1; idx < frame.length; idx += 1) {
          if (frame[idx].step > maxStep) {
            maxStep = frame[idx].step
          }
        }
        this.frameMaxSteps[frameIndex] = maxStep
      }
      else {
        this.frameMaxSteps[frameIndex] = undefined
      }
    }

    const smoothingRadius = Math.max(0, Math.floor(this.config.valueScaleSmoothing))
    let smoothedMinValues = [...frameMinValues]
    let smoothedMaxValues = [...frameMaxValues]
    if (smoothingRadius > 0 && this.data.length > 1) {
      smoothedMinValues = [...blur(frameMinValues, smoothingRadius) as Float64Array]
      smoothedMaxValues = [...blur(frameMaxValues, smoothingRadius) as Float64Array]
      for (let i = 0; i < this.data.length; i += 1) {
        if (Number.isNaN(smoothedMinValues[i])) {
          smoothedMinValues[i] = frameMinValues[i] ?? 0
        }
        if (Number.isNaN(smoothedMaxValues[i])) {
          smoothedMaxValues[i] = frameMaxValues[i] ?? 0
        }
      }
    }
    for (let i = 0; i < this.data.length; i += 1) {
      const minValue = smoothedMinValues[i] ?? frameMinValues[i] ?? 0
      const maxValue = smoothedMaxValues[i] ?? frameMaxValues[i] ?? 0
      this.frameValueScales[i] = getValueScale(this.config.valueScaleType, minValue, maxValue, this.config.valueScaleDelta)
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
            fontSize: 24,
            fill: 0xAA_AA_AA,
            fontFamily: this.config.fontFamily,
          },
        })
        tickText.anchor.set(1, 0.5)
        const tickLine = new Graphics()
        tickLine.setStrokeStyle({
          width: 1,
          color: 0x33_33_33,
          alpha: 0.4,
        })

        const tickContainer = new Container()
        tickLine.position.set(0, 0)
        tickText.position.set(-this.yAxisLabelPadding, 0)
        tickContainer.addChild(tickLine, tickText)
        this.yAxisTickContainer.addChild(tickContainer)
        this.ticksComponentMap.set(tick, tickContainer)
        this.tickLineMap.set(tick, tickLine)

        const tickWidth = this.measureTextWidth(tickText.text ?? '', tickText)
        this.tickLabelMaxWidth = Math.max(this.tickLabelMaxWidth, tickWidth)
        this.tickLabelHeight = Math.max(this.tickLabelHeight, tickText.height)
      }
    }
  }

  private applyTickSmoothing() {
    const swapFrames = this.config.swapDurationSec * this.config.fps
    for (const [tick, alphaList] of this.ticksAlphaMap.entries()) {
      const blurred = blur(alphaList, swapFrames / 6) as number[]
      this.ticksAlphaMap.set(tick, blurred)
    }
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
        color: 0x33_33_33,
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

  private updateCurrentMarker(frameIndex: number) {
    const frame = this.data[frameIndex]
    const primaryStep = frame[0]?.step
    const fallbackStep = this.frameMaxSteps[frameIndex]
    let markerX: number
    if (isFiniteNumber(primaryStep)) {
      markerX = this.clampToPlot(this.xScale(primaryStep))
    }
    else if (isFiniteNumber(fallbackStep)) {
      markerX = this.clampToPlot(this.xScale(fallbackStep))
    }
    else {
      markerX = this.clampToPlot(this.indexScale(frameIndex))
    }

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

  private updateAxisTickTexts() {
    const firstStep = this.findFirstDefinedStep()
    const lastStep = this.findLastDefinedStep()
    this.startTickLabel.text = firstStep === undefined ? '' : this.config.getStepLabel(firstStep)
    this.endTickLabel.text = lastStep === undefined ? '' : this.config.getStepLabel(lastStep)
    this.endTickLabel.position.set(this.plotWidth, 0)
  }

  private findFirstDefinedStep() {
    for (const value of this.frameMaxSteps) {
      if (value !== undefined) {
        return value
      }
    }
  }

  private findLastDefinedStep() {
    for (let i = this.frameMaxSteps.length - 1; i >= 0; i -= 1) {
      const value = this.frameMaxSteps[i]
      if (value !== undefined) {
        return value
      }
    }
  }

  private getXPosition(point: SeriesPoint) {
    const step = point.data.step
    if (isFiniteNumber(step)) {
      return this.clampToPlot(this.xScale(step))
    }
    return this.clampToPlot(this.indexScale(point.frameIndex))
  }

  private clampToPlot(value: number) {
    return clamp(value, 0, this.plotWidth)
  }

  private measureTextWidth(text: string, base: Text) {
    const fontFamily = Array.isArray(base.style.fontFamily) ? base.style.fontFamily.join(',') : base.style.fontFamily ?? ''
    const fontSize = typeof base.style.fontSize === 'number' ? base.style.fontSize : String(base.style.fontSize ?? '')
    const cacheKey = `${fontFamily}|${fontSize}|${text}`
    const cached = this.textWidthCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    try {
      const width = CanvasTextMetrics.measureText(text, base.style).width
      this.textWidthCache.set(cacheKey, width)
      return width
    }
    catch {
      const numericSize = typeof base.style.fontSize === 'number'
        ? base.style.fontSize
        : Number.parseFloat(String(base.style.fontSize ?? 0)) || 0
      const fallbackWidth = text.length * numericSize * 0.6
      this.textWidthCache.set(cacheKey, fallbackWidth)
      return fallbackWidth
    }
  }
}
