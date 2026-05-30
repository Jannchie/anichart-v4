import type { ScaleLinear } from 'd3'
import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet, median } from 'd3'
import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js'
import { BarComponent, EXTRA_VALUE_LABEL_PADDING } from './bar'
import { textureMap } from './resources'
import { getExtraValueLabelFontSize, getValueLabelFontSize } from './utils/labelFonts'
import { getValueScale } from './utils/scale'
import { measureTextWidth } from './utils/textMetrics'

const Z_ORDER_HYSTERESIS = 1
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
  referenceSpan: number = 0
  frameIdSets: InternSet<string>[]
  frameMaxSteps: Array<number | undefined>
  barZOrder: string[]
  constructor(data: RankedData[][], config: Config) {
    super()
    this.config = config
    this.data = data
    this.tickWidthMap = new Map()
    this.textWidthCache = new Map()
    const frameValueScales: ScaleLinear<number, number>[] = []
    const frameIdSets: InternSet<string>[] = []
    const frameMaxSteps: Array<number | undefined> = []
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
      // valueScale 的 min / max 取不同集合，避免入场/出场过渡 bar 造成 domain 阶跃或被拉低：
      //   下界 min —— 只看 alpha>=1 的稳定 bar：过渡 bar value 正在向 baseline 趋近，
      //     让它们定 min 会把值域往下拉甚至带到负区间，压扁正常 bar 宽度。
      //   上界 max —— 看 alpha>0 的渐入 bar：入场新柱 value 随缓动从 baseline 平滑爬到真实值，
      //     上界随之平滑抬升。若只认 alpha>=1，高分新柱在 alpha 渐近触及 1（easeInOutCubic 末端
      //     极平，可停在 1−5e-7 多帧）前被「整段排除」，触顶那一帧突然纳入 → domain 上界阶跃
      //     （坐标轴突跳）。出场 bar value 在降、不抬高 max，故纳入 emerging 集合安全。
      // 直接读 item.value（展示值），不走 config.getValue —— getValue 默认取 raw[valueField]，
      // 而新 DataProcessor 不再把 raw 字段铺到 Data 上。
      const stable = d.filter(item => item.alpha >= 1)
      const emerging = d.filter(item => item.alpha > 0)
      const [min] = extent(stable, item => item.value)
      const [, max] = extent(emerging, item => item.value)
      const safeMin = Number.isFinite(min) ? Number(min) : 0
      const safeMax = Number.isFinite(max) ? Number(max) : 0
      frameMinValues[i] = safeMin
      frameMaxValues[i] = safeMax
      frameValueScales[i] = getValueScale(config.valueScaleType, safeMin, safeMax, config.valueScaleDelta)
      frameIdSets[i] = new InternSet(d.map(item => item.id))
      let maxStep: number | undefined
      for (const item of d) {
        if (item.alpha <= 0) {
          continue
        }
        if (maxStep === undefined || item.step > maxStep) {
          maxStep = item.step
        }
      }
      frameMaxSteps[i] = maxStep
    }

    const smoothingRadius = Math.max(0, Math.floor(config.valueScaleSmoothing))
    let smoothedMinValues = [...frameMinValues]
    let smoothedMaxValues = [...frameMaxValues]
    if (smoothingRadius > 0 && data.length > 1) {
      // blur 会原地修改入参数组，传副本以保留 frameMin/MaxValues 的真实极值（domain 上界兜底要用真实 max）。
      smoothedMinValues = [...blur([...frameMinValues], smoothingRadius) as Float64Array]
      smoothedMaxValues = [...blur([...frameMaxValues], smoothingRadius) as Float64Array]
      for (let i = 0; i < data.length; i += 1) {
        if (Number.isNaN(smoothedMinValues[i])) {
          smoothedMinValues[i] = frameMinValues[i] ?? 0
        }
        if (Number.isNaN(smoothedMaxValues[i])) {
          smoothedMaxValues[i] = frameMaxValues[i] ?? 0
        }
      }
    }
    // adaptive 参考尺度：屏内首尾差距的中位数，作为软饱和半衰尺度（与 DataProcessor.buildBaselineScale 同步）。
    const spans: number[] = []
    for (let i = 0; i < data.length; i += 1) {
      const s = (smoothedMaxValues[i] ?? 0) - (smoothedMinValues[i] ?? 0)
      if (s > 0) {
        spans.push(s)
      }
    }
    this.referenceSpan = median(spans) ?? 1
    const adaptiveOptions = {
      referenceSpan: this.referenceSpan,
      minRatio: config.valueScaleMinRatio,
      maxRatio: config.valueScaleMaxRatio,
    }
    for (let i = 0; i < data.length; i += 1) {
      const minValue = smoothedMinValues[i] ?? frameMinValues[i] ?? 0
      // domain 上界不低于当前帧真实 max：平滑滞后会把上升中的榜首 clamp，使柱长对应的刻度 < 数值标签。
      const maxValue = Math.max(smoothedMaxValues[i] ?? 0, frameMaxValues[i] ?? 0)
      frameValueScales[i] = getValueScale(config.valueScaleType, minValue, maxValue, config.valueScaleDelta, adaptiveOptions)
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
    this.barZOrder = []
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
    // 入场/出场期间 value=0 时 width=0 自然不可见，valueLabel 也不显示。
    // value 一旦 >0 就跟着显示数字 —— 数值动画的核心视觉。
    if (item.alpha <= 0 || item.value <= 0) {
      return { valueText: '', extraText: '', totalWidth: 0 }
    }
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
        if (item.alpha <= 0) {
          continue
        }
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
      // 与构造期一致：下界看稳定 bar、上界看渐入 bar（见上方主路径注释）。
      const stable = data.filter(item => item.alpha >= 1)
      const emerging = data.filter(item => item.alpha > 0)
      const [min] = extent(stable, d => d.value)
      const [, max] = extent(emerging, d => d.value)
      valueScale = getValueScale(config.valueScaleType, min, max, config.valueScaleDelta, {
        referenceSpan: this.referenceSpan,
        minRatio: config.valueScaleMinRatio,
        maxRatio: config.valueScaleMaxRatio,
      })
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
    // 维护全局 z-order：按 blurRank 升序排列；越靠后 zIndex 越高 → 原本位置越下方的 bar 渲染越上层，
    // 等价于"上升者覆盖下降者"。bubble sort 带 hysteresis，仅当相邻 bar 已错开 > HYS 时才允许交换，
    // 重叠中（即使方向反转）层叠顺序保持稳定。
    const blurRankMap = new Map<string, number>()
    for (const d of data) {
      blurRankMap.set(d.id, d.blurRank)
    }
    const knownInOrder = new Set(this.barZOrder)
    for (const d of data) {
      if (knownInOrder.has(d.id)) {
        continue
      }
      let insertIdx = this.barZOrder.length
      for (let k = 0; k < this.barZOrder.length; k += 1) {
        const otherBlur = blurRankMap.get(this.barZOrder[k])
        if (otherBlur === undefined) {
          continue
        }
        if (d.blurRank < otherBlur) {
          insertIdx = k
          break
        }
      }
      this.barZOrder.splice(insertIdx, 0, d.id)
      knownInOrder.add(d.id)
    }
    let swapped = true
    while (swapped) {
      swapped = false
      for (let i = 0; i < this.barZOrder.length - 1; i += 1) {
        const ba = blurRankMap.get(this.barZOrder[i])
        const bb = blurRankMap.get(this.barZOrder[i + 1])
        if (ba === undefined || bb === undefined) {
          continue
        }
        if (ba > bb + Z_ORDER_HYSTERESIS) {
          const tmp = this.barZOrder[i]
          this.barZOrder[i] = this.barZOrder[i + 1]
          this.barZOrder[i + 1] = tmp
          swapped = true
        }
      }
    }
    for (let i = 0; i < this.barZOrder.length; i += 1) {
      const bar = this.barComponentMap.get(this.barZOrder[i])
      if (bar) {
        bar.zIndex = i
      }
    }
    // 宽度直接由 bar 自己的 value 通过 valueScale 算出 —— width 跟 value 严格绑定（横向），
    // y 跟 blurRank 严格绑定（纵向）。两者解耦，避免新模型下 visualOrder lag 导致的"宽度跟数值脱节"。
    // 入场/出场期间 value=0 时 width=0 自然不可见。
    const maxBarWidth = this.maxBarWidth
    const widthForValue = (v: number): number => {
      const ratio = Math.max(0, Math.min(valueScale(v), 1))
      return maxBarWidth * ratio
    }
    for (const [i, d] of data.entries()) {
      const bar = this.barComponentMap.get(d.id)!
      const barWidth = widthForValue(d.value)
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
