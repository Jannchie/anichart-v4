import type { ScaleLinear } from 'd3'
import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet } from 'd3'
import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js'
import { BarComponent, EXTRA_VALUE_LABEL_PADDING } from './bar'
import { textureMap } from './resources'
import { getExtraValueLabelFontSize, getValueLabelFontSize } from './utils/labelFonts'
import { getValueScale } from './utils/scale'
import { measureTextWidth } from './utils/textMetrics'

const LAYER_SETTLE_EPSILON = 0.01
const TITLE_FONT_SIZE = 36
const TITLE_PADDING = 24

export class BarChart extends Container {
  maxBarWidth: number
  barComponentMap: Map<string, BarComponent>
  xAxis: Container
  stepLabel: Text
  titleLabel: Text
  data: RankedData[][]
  config: Config
  ticksAlphaMap: Map<number, number[]>
  ticksComponentMap: Map<number, Container>
  barMain: Container
  tickLabelHeight: number = 0
  xAxisLabel: Text
  xAxisTickContainer: Container
  xAxisLabelPadding: number = 10
  tickWidthMap: Map<number, number>
  textWidthCache: Map<string, number>
  axisOffset: number
  totalAvailableWidth: number
  valueLabelStyle: TextStyle
  extraValueLabelStyle: TextStyle
  frameValueScales: ScaleLinear<number, number>[]
  frameIdSets: InternSet<string>[]
  frameMaxSteps: Array<number | undefined>
  barLayerDirection: Map<string, 'up' | 'down'>
  constructor(data: RankedData[][], config: Config) {
    super()
    this.config = config
    this.data = data
    this.tickWidthMap = new Map()
    this.textWidthCache = new Map()
    const frameValueScales: ScaleLinear<number, number>[] = []
    const frameIdSets: InternSet<string>[] = []
    const frameMaxSteps: Array<number | undefined> = []
    const barLayerDirection = new Map<string, 'up' | 'down'>()
    const idList = [...new InternSet(data.flat().map(d => d.id))]
    const idImageMap = new Map(new InternSet(data.flat().map((d) => {
      return [d.id, textureMap.get(d.raw[config.imageField])]
    })))
    this.xAxis = new Container()
    this.xAxisTickContainer = new Container()
    // 计算 ticks 对象
    // 遍历 data
    const frameMinValues: number[] = []
    const frameMaxValues: number[] = []

    this.xAxisLabel = new Text({
      text: config.xAxisLabel,
      style: {
        fontSize: 32,
        fill: 0xAA_AA_AA,
        fontFamily: config.fontFamily,
      },
    })

    const hasXAxisLabel = Boolean(config.xAxisLabel?.trim())
    const xAxisLabelPaddingUsed = hasXAxisLabel ? this.xAxisLabelPadding : 0
    const xAxisLabelHeight = hasXAxisLabel ? this.xAxisLabel.height : 0

    for (const [i, d] of data.entries()) {
      const [min, max] = extent(d, config.getValue)
      const safeMin = Number.isFinite(min) ? Number(min) : 0
      const safeMax = Number.isFinite(max) ? Number(max) : 0
      frameMinValues[i] = safeMin
      frameMaxValues[i] = safeMax
      frameValueScales[i] = getValueScale(config.valueScaleType, safeMin, safeMax, config.valueScaleDelta)
      frameIdSets[i] = new InternSet(d.map(item => item.id))
      if (d.length > 0) {
        let maxStep = d[0].step
        for (let idx = 1; idx < d.length; idx += 1) {
          const step = d[idx].step
          if (step > maxStep) {
            maxStep = step
          }
        }
        frameMaxSteps[i] = maxStep
      }
      else {
        frameMaxSteps[i] = undefined
      }
    }

    const smoothingRadius = Math.max(0, Math.floor(config.valueScaleSmoothing))
    let smoothedMinValues = [...frameMinValues]
    let smoothedMaxValues = [...frameMaxValues]
    if (smoothingRadius > 0 && data.length > 1) {
      smoothedMinValues = [...blur(frameMinValues, smoothingRadius) as Float64Array]
      smoothedMaxValues = [...blur(frameMaxValues, smoothingRadius) as Float64Array]
      for (let i = 0; i < data.length; i += 1) {
        if (Number.isNaN(smoothedMinValues[i])) {
          smoothedMinValues[i] = frameMinValues[i] ?? 0
        }
        if (Number.isNaN(smoothedMaxValues[i])) {
          smoothedMaxValues[i] = frameMaxValues[i] ?? 0
        }
      }
    }
    for (let i = 0; i < data.length; i += 1) {
      const minValue = smoothedMinValues[i] ?? frameMinValues[i] ?? 0
      const maxValue = smoothedMaxValues[i] ?? frameMaxValues[i] ?? 0
      frameValueScales[i] = getValueScale(config.valueScaleType, minValue, maxValue, config.valueScaleDelta)
    }

    const ticksAlphaMap = new Map<number, Array<number>>()
    const ticksComponentMap = new Map<number, Container>()
    const tickSet = new InternSet<number>()

    for (const [i] of data.entries()) {
      const scale = frameValueScales[i]
      const ticks = scale.ticks(config.tickNum)
      for (const tick of ticks) {
        if (tickSet.has(tick)) {
          const numberList = ticksAlphaMap.get(tick)!
          numberList[i] = 1
        }
        else {
          tickSet.add(tick)
          const numberList = Array.from<number>({ length: data.length }).fill(0)
          numberList[i] = 1
          ticksAlphaMap.set(tick, numberList)
          const tickText = new Text({
            text: tick.toString(),
            style: {
              fontSize: config.tickLabelFontSize,
              fill: 0xAA_AA_AA,
              fontFamily: config.fontFamily,
            },
          })

          const tickLine = new Graphics()
          const tickComp = new Container({
            children: [
              tickText,
              tickLine,
            ],
          })
          tickLine.setStrokeStyle({
            width: 1,
            color: 0x33_33_33,
          })

          const tickBounds = tickText.getBounds()
          const tickWidth = tickBounds.width

          const tickLabelHeight = tickBounds.height
          this.tickLabelHeight = tickLabelHeight
          tickLine.moveTo(tickWidth / 2, this.tickLabelHeight)
          tickLine.lineTo(tickWidth / 2, config.height - xAxisLabelHeight - xAxisLabelPaddingUsed)
          tickLine.stroke()

          tickComp.position.set(-tickWidth / 2, 0)
          ticksComponentMap.set(tick, tickComp)
          this.xAxisTickContainer.addChild(tickComp)
          this.tickWidthMap.set(tick, tickWidth)
        }
      }
    }

    const showTitle = Boolean(config.title?.trim())
    const titleLabel = new Text({
      text: config.title,
      style: {
        fontSize: TITLE_FONT_SIZE,
        fill: 0xFF_FF_FF,
        fontFamily: config.fontFamily,
        fontWeight: 'bold',
        align: 'center',
      },
    })
    const titleFontSize = typeof titleLabel.style.fontSize === 'number'
      ? titleLabel.style.fontSize
      : Number.parseFloat(String(titleLabel.style.fontSize ?? 0)) || 0
    let titleOffset = showTitle ? Math.max(titleLabel.height, titleFontSize) + TITLE_PADDING : 0
    this.titleLabel = titleLabel

    // center xAxis
    this.xAxisLabel.anchor.set(0.5, 0)
    this.xAxisLabel.position.set(0, 0)
    this.xAxisTickContainer.position.set(0, xAxisLabelHeight + xAxisLabelPaddingUsed)
    this.xAxis.addChild(this.xAxisTickContainer, this.xAxisLabel)
    // tickComp 上面腾出 xAxixLabel 的位置
    // // 自动重新设置 barHeight
    if (config.autoBarHeight) {
      config.barHeight = ((config.height - titleOffset - this.tickLabelHeight - xAxisLabelPaddingUsed - xAxisLabelHeight) / config.topN) - config.barGap
    }
    const labelMap = new Map<string, string>()
    for (const item of data.flat()) {
      if (!labelMap.has(item.id)) {
        labelMap.set(item.id, item.label)
      }
    }
    const maxLabelWidth = config.showLabel ? this.getMaxLabelWidth([...labelMap.values()], config) : 0

    const barComponentMap = new Map<string, BarComponent>(idList.map((id) => {
      const imageTexture = idImageMap.get(id)
      const imgSprite = imageTexture ? Sprite.from(imageTexture) : undefined
      const comp = new BarComponent({
        x: 0,
        y: 0,
        width: 0,
        height: config.barHeight,
        label: labelMap.get(id) ?? '',
        fontSize: config.barHeight,
        colorLabel: 0xFF_FF_FF,
        leftLabelPadding: config.leftLabelPadding,
        barInfoPadding: config.barInfoPadding,
        barInfoStyle: config.barInfoStyle,
        image: imgSprite,
        leftLabelWidth: maxLabelWidth,
        showLabel: config.showLabel,
        valueLabelPadding: config.valueLabelPadding,
        radius: config.borderRadius,
      })
      return [id, comp]
    }))
    // 设置最大的 label 宽度
    for (const v of barComponentMap.values()) {
      v.settings.leftLabelWidth = maxLabelWidth
      v.settings.showLabel = config.showLabel
    }
    const axisOffset = config.showLabel ? maxLabelWidth + config.leftLabelPadding : 0
    this.axisOffset = axisOffset
    this.totalAvailableWidth = Math.max(config.width - axisOffset, 0)

    const valueFontSize = getValueLabelFontSize(config.barHeight)
    const extraFontSize = getExtraValueLabelFontSize(valueFontSize)
    this.valueLabelStyle = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize: valueFontSize,
    })
    this.extraValueLabelStyle = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize: extraFontSize,
    })

    const rightReservedWidth = this.getRightReservedWidth(data, config, frameValueScales)

    // Determine drawable width after reserving space for labels and padding
    const maxBarWidth = Math.max(this.totalAvailableWidth - rightReservedWidth, 0)
    this.maxBarWidth = maxBarWidth
    this.xAxisLabel.position.set(this.maxBarWidth / 2, 0)
    this.xAxisLabel.visible = hasXAxisLabel
    this.xAxisLabel.renderable = hasXAxisLabel

    titleOffset = showTitle ? Math.max(titleLabel.height, titleFontSize) + TITLE_PADDING : 0
    titleLabel.anchor.set(0.5, 0)
    titleLabel.position.set(config.width / 2, 0)
    titleLabel.visible = showTitle
    titleLabel.renderable = showTitle

    const swapFrames = config.swapDurationSec * config.fps
    // 对 ticksAlpha 的每一个 value 执行 blur
    for (const [tick, alphaList] of ticksAlphaMap.entries()) {
      const blurAlphaList = blur(alphaList, swapFrames / 6) as number[]
      ticksAlphaMap.set(tick, blurAlphaList)
    }
    this.ticksComponentMap = ticksComponentMap
    this.ticksAlphaMap = ticksAlphaMap

    const stepLabel = new Text({
      style: {
        fontSize: 48,
        fill: 16_777_215,
        // fontWeight: 'bold',
        fontFamily: config.fontFamily,
      },
    })

    this.stepLabel = stepLabel
    this.position.set(config.x, config.y)
    this.barMain = new Container()
    this.barMain.sortableChildren = true
    this.barMain.addChild(...barComponentMap.values())
    this.addChild(titleLabel)
    this.addChild(this.xAxis)
    this.addChild(stepLabel)
    this.addChild(this.barMain)
    const barMainOffsetX = config.showLabel ? maxLabelWidth : 0
    const barMainOffsetY = titleOffset + xAxisLabelHeight + xAxisLabelPaddingUsed + this.tickLabelHeight
    this.barMain.position.set(barMainOffsetX, barMainOffsetY)
    this.xAxis.position.set(axisOffset, titleOffset)
    this.barComponentMap = barComponentMap
    this.frameValueScales = frameValueScales
    this.frameIdSets = frameIdSets
    this.frameMaxSteps = frameMaxSteps
    this.barLayerDirection = barLayerDirection
    if (config.showStepLabel) {
      stepLabel.anchor.set(1, 1)
      stepLabel.position.set(config.width, config.height)
    }
    else {
      stepLabel.renderable = false
    }
  }

  private getMaxLabelWidth(labels: string[], config: Config) {
    if (labels.length === 0) {
      return 0
    }
    const style = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize: config.barHeight,
    })
    let maxLabelWidth = 0
    // 计算最大的 label 宽度
    for (const label of labels) {
      const width = measureTextWidth(label ?? '', style, this.textWidthCache)
      maxLabelWidth = Math.max(maxLabelWidth, width)
    }
    return maxLabelWidth
  }

  private getValueLabelInfo(item: RankedData, config: Config) {
    const valueLabel = config.getValueLabel(item)
    const extraLabel = config.getValueExtra(item)
    const valueText = valueLabel === undefined || valueLabel === null ? '' : String(valueLabel)
    const extraText = extraLabel === undefined || extraLabel === null ? '' : String(extraLabel)
    const valueWidth = valueText ? measureTextWidth(valueText, this.valueLabelStyle, this.textWidthCache) : 0
    const extraWidth = extraText ? measureTextWidth(extraText, this.extraValueLabelStyle, this.textWidthCache) : 0
    const basePadding = config.valueLabelPadding ?? 0
    let totalWidth = basePadding + valueWidth
    if (extraWidth > 0) {
      totalWidth += EXTRA_VALUE_LABEL_PADDING + extraWidth
    }
    return {
      valueText,
      extraText,
      totalWidth,
    }
  }

  private getRightReservedWidth(data: RankedData[][], config: Config, frameValueScales: ScaleLinear<number, number>[]) {
    if (data.length === 0 || this.totalAvailableWidth <= 0) {
      return 0
    }
    const totalAvailable = this.totalAvailableWidth
    let maxRequired = 0
    for (const [frameIndex, frame] of data.entries()) {
      const scale = frameValueScales[frameIndex]
      if (!scale) {
        continue
      }
      for (const item of frame) {
        const { totalWidth } = this.getValueLabelInfo(item, config)
        if (totalWidth <= 0) {
          continue
        }
        const ratio = Math.max(0, Math.min(scale(item.value), 1))
        if (ratio <= 0) {
          if (totalWidth > totalAvailable) {
            continue
          }
          continue
        }
        const required = (totalWidth - totalAvailable * (1 - ratio)) / ratio
        if (required > totalAvailable) {
          continue
        }
        if (required > maxRequired) {
          maxRequired = required
        }
      }
    }
    return Math.max(0, Math.min(maxRequired, totalAvailable))
  }

  update(idx: number) {
    if (idx >= this.data.length) {
      return
    }
    const config = this.config
    const data = this.data[idx]
    let valueScale = this.frameValueScales[idx]
    if (!valueScale) {
      const [min, max] = extent(data, d => d.value)
      valueScale = getValueScale(config.valueScaleType, min, max, config.valueScaleDelta)
      this.frameValueScales[idx] = valueScale
    }
    for (const [tick, alphaList] of this.ticksAlphaMap.entries()) {
      const tickComp = this.ticksComponentMap.get(tick)!
      tickComp.alpha = alphaList[idx]
      const width = this.tickWidthMap.get(tick) ?? tickComp.children[0].getBounds().width
      if (!this.tickWidthMap.has(tick)) {
        this.tickWidthMap.set(tick, width)
      }
      tickComp.position.set(valueScale(tick) * this.maxBarWidth - width / 2, 0)
    }
    let barIdSet = this.frameIdSets[idx]
    if (!barIdSet) {
      barIdSet = new InternSet(data.map(d => d.id))
      this.frameIdSets[idx] = barIdSet
    }
    for (const [i, d] of data.entries()) {
      const bar = this.barComponentMap.get(d.id)!
      const previousDirection = this.barLayerDirection.get(d.id)
      const isSettled = Math.abs(d.blurRank - d.rank) < LAYER_SETTLE_EPSILON
      let effectiveDirection = previousDirection ?? (d.up ? 'up' : 'down')
      if (d.up) {
        effectiveDirection = 'up'
      }
      else if (effectiveDirection === 'up') {
        if (isSettled) {
          effectiveDirection = 'down'
        }
      }
      else {
        effectiveDirection = 'down'
      }
      this.barLayerDirection.set(d.id, effectiveDirection)
      bar.zIndex = effectiveDirection === 'up' ? 2 : 1
      const valueRatio = Math.max(0, Math.min(valueScale(d.value), 1))
      const barWidth = this.maxBarWidth * valueRatio
      const { valueText, extraText, totalWidth } = this.getValueLabelInfo(d, config)
      const canShowValue = totalWidth <= (this.totalAvailableWidth - barWidth)
      bar.update({
        y: d.blurRank * (config.barHeight + config.barGap),
        label: d.label,
        width: barWidth,
        alpha: d.alpha,
        color: config.getColor(d),
        valueLabel: canShowValue ? valueText : '',
        extraValueLabel: canShowValue ? extraText : '',
        barInfo: config.getBarInfo(d, i, idx),
        showLabel: config.showLabel,
      })
    }
    for (const [id, bar] of this.barComponentMap.entries()) {
      if (!barIdSet.has(id)) {
        bar.update({ alpha: 0 })
      }
    }
    if (this.config.showStepLabel) {
      const maxStep = this.frameMaxSteps[idx]
      this.stepLabel.text = maxStep === undefined ? '' : config.getStepLabel(maxStep)
    }
    else {
      this.stepLabel.renderable = false
    }
  }
}
