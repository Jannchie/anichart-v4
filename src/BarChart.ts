import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { InternSet, blur, extent, scaleLinear } from 'd3'
import { BarComponent } from './bar'
import type { Data } from './Data'
import type { Config } from './Config'
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
  data: Data[][]
  config: Config
  ticksAlphaMap: Map<number, number[]>
  ticksComponentMap: Map<number, Container>
  barMain: Container
  tickLabelHeight: number = 0
  xAxisLabel: Text
  xAxisTickContainer: Container
  xAxisLabelPadding: number = 10
  constructor(data: Data[][], config: Config) {
    super()
    this.config = config
    this.data = data
    const idList = Array.from(new InternSet(data.flat().map(d => d.id)))
    const labelList = Array.from(new InternSet(data.flat().map(d => d.label)))
    const idImageMap = new Map(Array.from(new InternSet(data.flat().map((d) => {
      return [d.id, textureMap.get(d.raw[config.imageField])]
    }))))
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
        fill: 0xAAAAAA,
        fontFamily: config.fontFamily,
      },
    })

    data.forEach((d, i) => {
      const [min, max] = extent(d, config.getValue)
      const scale = getValueScale(config.valueScaleType, min, max)
      const ticks = scale.ticks(config.tickNum)

      ticks.forEach((tick) => {
        if (!tickSet.has(tick)) {
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
              fill: 0xAAAAAA,
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
            color: 0x333333,
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
        }
        else {
          const numberList = ticksAlphaMap.get(tick)!
          numberList[i] = 1
        }
      })
    })

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
    const barComponentMap = new Map<string, BarComponent>(idList.map((id, i) => {
      const imageTexture = idImageMap.get(id)
      const imgSprite = imageTexture ? Sprite.from(imageTexture) : undefined
      const comp = new BarComponent({
        x: 0,
        y: 0,
        width: 0,
        height: config.barHeight,
        label: labelList[i],
        fontSize: config.barHeight,
        colorLabel: 0xFFFFFF,
        leftLabelPadding: config.leftLabelPadding,
        barInfoPadding: config.barInfoPadding,
        barInfoStyle: config.barInfoStyle,
        image: imgSprite,
      })
      return [id, comp]
    }))
    const maxLabelWidth = this.getMaxLabelWidth(barComponentMap)
    // 设置最大的 label 宽度
    barComponentMap.forEach((v) => {
      v.settings.leftLabelWidth = maxLabelWidth
    })
    // 计算最大的 valueLabel 宽度
    const maxValueLabelWidth = data.flat().reduce((max, d) => {
      const comp = barComponentMap.get(d.id)!
      comp.update({
        valueLabel: config.getValueLabel(d),
        extraValueLabel: config.getValueExtra(d),
      })
      return Math.max(max, comp.valueContainer.width)
    }, 0)

    // 最大柱子宽度 = 设置宽度 - 最大 left label 宽度 - 最大 value label 宽度 - left label padding - value label padding - padding
    const maxBarWidth = config.width - maxLabelWidth - maxValueLabelWidth - config.leftLabelPadding - config.valueLabelPadding
    this.maxBarWidth = maxBarWidth

    const swapFrames = config.swapDurationSec * config.fps
    // 对 ticksAlpha 的每一个 value 执行 blur
    ticksAlphaMap.forEach((alphaList, tick) => {
      const blurAlphaList = blur(alphaList, swapFrames / 6) as number[]
      ticksAlphaMap.set(tick, blurAlphaList)
    })
    this.ticksComponentMap = ticksComponentMap
    this.ticksAlphaMap = ticksAlphaMap

    const stepLabel = new Text({
      style: {
        fontSize: 48,
        fill: 16777215,
        // fontWeight: 'bold',
        fontFamily: config.fontFamily,
      },
    })

    this.stepLabel = stepLabel
    this.position.set(config.x, config.y)
    this.barMain = new Container()
    this.barMain.addChild(...Array.from(barComponentMap.values()))
    this.addChild(this.xAxis)
    this.addChild(stepLabel)
    this.addChild(this.barMain)
    this.barMain.position.set(maxLabelWidth, this.xAxisLabel.height + this.xAxisLabelPadding + this.tickLabelHeight)
    this.xAxis.position.set(maxLabelWidth + config.leftLabelPadding, 0)
    this.barComponentMap = barComponentMap
  }

  private getMaxLabelWidth(barComponentMap: Map<string, BarComponent>) {
    let maxLabelWidth = 0
    // 计算最大的 label 宽度
    barComponentMap.forEach((v) => {
      maxLabelWidth = Math.max(maxLabelWidth, v.leftLabel.width)
    })
    return maxLabelWidth
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
    this.ticksAlphaMap.forEach((alphaList, tick) => {
      const tickComp = this.ticksComponentMap.get(tick)!
      tickComp.alpha = alphaList[idx]
      const width = tickComp.children[0].getBounds().width
      tickComp.position.set(valueScale(tick) * this.maxBarWidth - width / 2, 0)
    })
    const barIdSet = new InternSet(data.map(d => d.id))
    for (let i = 0; i < data.length; i++) {
      const d = data[i]
      const bar = this.barComponentMap.get(d.id)!
      if (d.up) {
        bar.zIndex = 2
      }
      else {
        bar.zIndex = 1
      }
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
    this.barComponentMap.forEach((bar, id) => {
      if (!barIdSet.has(id)) {
        bar.update({ alpha: 0 })
      }
    })
    if (this.config.showStepLabel) {
      this.stepLabel.anchor.set(1, 1)
      // 设置 step label 的位置
      this.stepLabel.position.set(config.width, config.height)
      // 从第一个数据中获取 step
      this.stepLabel.text = config.getStepLabel(data[0].step)
    }
    else {
      this.stepLabel.renderable = false
    }
  }
}
