import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet, scaleLinear } from 'd3'
import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js'
import { BarComponent, EXTRA_VALUE_LABEL_PADDING } from './bar'
import { textureMap } from './main'

function getValueScale(type: string, min?: number, max?: number, delta: number = 1000) {
  min = min || 0
  max = max || 1
  if (type === 'from-zero') {
    return scaleLinear().domain([0, max]).range([0, 1])
  }
  if (type === 'from-min') {
    return scaleLinear().domain([min - (max - min), max]).range([0, 1])
  }
  if (type === 'from-delta') {
    return scaleLinear().domain([max - delta, max]).range([0, 1])
  }
  throw new Error('Unknown value scale type')
}
export class BarChart extends Container {
  maxBarWidth: number
  barComponentMap: Map<string, BarComponent>
  xAxis: Container
  stepLabel: Text
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
  constructor(data: RankedData[][], config: Config) {
    super()
    this.config = config
    this.data = data
    this.tickWidthMap = new Map()
    this.textWidthCache = new Map()
    const idList = [...new InternSet(data.flat().map(d => d.id))]
    const idImageMap = new Map(new InternSet(data.flat().map((d) => {
      return [d.id, textureMap.get(d.raw[config.imageField])]
    })))
    this.xAxis = new Container()
    this.xAxisTickContainer = new Container()
    // 计算 ticks 对象
    // 遍历 data
    const ticksAlphaMap = new Map<number, Array<number>>()
    const ticksComponentMap = new Map<number, Container>()
    const tickSet = new InternSet<number>()

    this.xAxisLabel = new Text({
      text: config.xAxisLabel,
      style: {
        fontSize: 32,
        fill: 0xAA_AA_AA,
        fontFamily: config.fontFamily,
      },
    })

    for (const [i, d] of data.entries()) {
      const [min, max] = extent(d, config.getValue)
      const scale = getValueScale(config.valueScaleType, min, max)
      const ticks = scale.ticks(config.tickNum)

      for (const tick of ticks) {
        if (tickSet.has(tick)) {
          const numberList = ticksAlphaMap.get(tick)!
          numberList[i] = 1
        }
        else {
          tickSet.add(tick)
          const numberList: number[] = []
          numberList.length = data.length
          numberList.fill(0)
          numberList[i] = 1
          ticksAlphaMap.set(tick, numberList)
          const tickText = new Text({
            text: tick.toString(),
            style: {
              fontSize: 24,
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
          tickLine.lineTo(tickWidth / 2, config.height - this.xAxisLabel.height - this.xAxisLabelPadding)
          tickLine.stroke()

          tickComp.position.set(-tickWidth / 2, 0)
          ticksComponentMap.set(tick, tickComp)
          this.xAxisTickContainer.addChild(tickComp)
          this.tickWidthMap.set(tick, tickWidth)
        }
      }
    }

    // center xAxis
    this.xAxisLabel.anchor.set(0.5, 0)
    this.xAxisLabel.position.set(config.width / 2, 0)
    this.xAxisTickContainer.position.set(0, this.tickLabelHeight + this.xAxisLabelPadding)
    this.xAxis.addChild(this.xAxisTickContainer, this.xAxisLabel)
    // tickComp 上面腾出 xAxixLabel 的位置
    // // 自动重新设置 barHeight
    if (config.autoBarHeight) {
      config.barHeight = ((config.height - this.tickLabelHeight - this.xAxisLabelPadding - this.xAxisLabel.height) / config.topN) - config.barGap
    }
    const labelMap = new Map<string, string>()
    for (const item of data.flat()) {
      if (!labelMap.has(item.id)) {
        labelMap.set(item.id, item.label)
      }
    }
    const maxLabelWidth = this.getMaxLabelWidth([...labelMap.values()], config)

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
      })
      return [id, comp]
    }))
    // 设置最大的 label 宽度
    for (const v of barComponentMap.values()) {
      v.settings.leftLabelWidth = maxLabelWidth
    }
    const maxValueLabelWidth = this.getMaxValueLabelWidth(data, config)

    // 最大柱子宽度 = 设置宽度 - 最大 left label 宽度 - 最大 value label 宽度 - left label padding - value label padding - padding
    const maxBarWidth = config.width - maxLabelWidth - maxValueLabelWidth - config.leftLabelPadding - config.valueLabelPadding
    this.maxBarWidth = maxBarWidth

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
    this.barMain.addChild(...barComponentMap.values())
    this.addChild(this.xAxis)
    this.addChild(stepLabel)
    this.addChild(this.barMain)
    this.barMain.position.set(maxLabelWidth, this.xAxisLabel.height + this.xAxisLabelPadding + this.tickLabelHeight)
    this.xAxis.position.set(maxLabelWidth + config.leftLabelPadding, 0)
    this.barComponentMap = barComponentMap
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
      const width = this.measureTextWidth(label ?? '', style)
      maxLabelWidth = Math.max(maxLabelWidth, width)
    }
    return maxLabelWidth
  }

  private getMaxValueLabelWidth(data: RankedData[][], config: Config) {
    const flatData = data.flat()
    if (flatData.length === 0) {
      return 0
    }
    const valueStyle = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize: Math.max(config.barHeight - 12, 1),
    })
    const extraStyle = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize: 32,
    })
    let maxWidth = 0
    const basePadding = config.valueLabelPadding ?? 0

    for (const item of flatData) {
      const valueLabel = config.getValueLabel(item)
      const extraLabel = config.getValueExtra(item)
      const valueText = valueLabel === undefined || valueLabel === null ? '' : String(valueLabel)
      const extraText = extraLabel === undefined || extraLabel === null ? '' : String(extraLabel)
      const valueWidth = valueText ? this.measureTextWidth(valueText, valueStyle) : 0
      const extraWidth = extraText ? this.measureTextWidth(extraText, extraStyle) : 0

      let totalWidth = basePadding + valueWidth
      if (extraWidth > 0) {
        totalWidth += EXTRA_VALUE_LABEL_PADDING + extraWidth
      }
      maxWidth = Math.max(maxWidth, totalWidth)
    }
    return maxWidth
  }

  private measureTextWidth(text: string, style: TextStyle) {
    const cacheKey = this.getTextWidthCacheKey(text, style)
    const cached = this.textWidthCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    try {
      const width = CanvasTextMetrics.measureText(text, style).width
      this.textWidthCache.set(cacheKey, width)
      return width
    }
    catch {
      const fontSize = typeof style.fontSize === 'number' ? style.fontSize : Number.parseFloat(String(style.fontSize)) || 0
      const averageCharWidth = fontSize * 0.6
      const fallbackWidth = text.length * averageCharWidth
      this.textWidthCache.set(cacheKey, fallbackWidth)
      return fallbackWidth
    }
  }

  private getTextWidthCacheKey(text: string, style: TextStyle) {
    const fontFamily = Array.isArray(style.fontFamily) ? style.fontFamily.join(',') : style.fontFamily ?? ''
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : String(style.fontSize ?? '')
    return `${fontFamily}|${fontSize}|${text}`
  }

  update(idx: number) {
    if (idx >= this.data.length) {
      return
    }
    const config = this.config
    const data = this.data[idx]
    if (idx >= this.data.length) {
      return
    }
    const [min, max] = extent(data, d => d.value)
    const valueScale = getValueScale(config.valueScaleType, min, max, config.valueScaleDelta)
    for (const [tick, alphaList] of this.ticksAlphaMap.entries()) {
      const tickComp = this.ticksComponentMap.get(tick)!
      tickComp.alpha = alphaList[idx]
      const width = this.tickWidthMap.get(tick) ?? tickComp.children[0].getBounds().width
      if (!this.tickWidthMap.has(tick)) {
        this.tickWidthMap.set(tick, width)
      }
      tickComp.position.set(valueScale(tick) * this.maxBarWidth - width / 2, 0)
    }
    const barIdSet = new InternSet(data.map(d => d.id))
    for (const [i, d] of data.entries()) {
      const bar = this.barComponentMap.get(d.id)!

      bar.zIndex = d.up ? 2 : 1

      bar.update({
        y: d.blurRank * (config.barHeight + config.barGap),
        label: d.label,
        width: this.maxBarWidth * valueScale(d.value),
        alpha: d.alpha,
        color: config.getColor(d),
        valueLabel: config.getValueLabel(d),
        extraValueLabel: config.getValueExtra(d),
        barInfo: config.getBarInfo(d, i, idx),
      })
    }
    for (const [id, bar] of this.barComponentMap.entries()) {
      if (!barIdSet.has(id)) {
        bar.update({ alpha: 0 })
      }
    }
    if (this.config.showStepLabel) {
      this.stepLabel.anchor.set(1, 1)
      // 设置 step label 的位置
      this.stepLabel.position.set(config.width, config.height)
      // 获取所有数据中最大的 step 值
      const maxStep = Math.max(...this.data[idx].map(d => d.step))
      this.stepLabel.text = config.getStepLabel(maxStep)
    }
    else {
      this.stepLabel.renderable = false
    }
  }
}
