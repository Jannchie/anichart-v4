import type { ScaleLinear } from 'd3'
import type { Texture } from 'pixi.js'
import type { Config } from './Config'
import type { RankedData } from './Data'
import { blur, extent, InternSet, scaleLinear } from 'd3'
import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { BarComponent, EXTRA_VALUE_LABEL_PADDING } from './bar'
import { textureMap } from './resources'
import { AXIS_TITLE_FONT_SIZE, computeReferenceSpan, MUTED_LABEL_COLOR, smoothTicksAlpha, SUBTITLE_FONT_SIZE, SUBTITLE_GAP, TICK_LINE_COLOR, TITLE_FONT_SIZE, TITLE_PADDING } from './utils/chartChrome'
import { getExtraValueLabelFontSize, getValueLabelFontSize } from './utils/labelFonts'
import { getValueScale } from './utils/scale'
import { measureTextWidth } from './utils/textMetrics'
import { scrambleText } from './utils/textScramble'

// 某条目某段恒定值的区间起点：{ frame: 该值生效的首帧, value: 文本 / banner 图 key }。
// 相邻段之间即一次「变化」——文本是一次扰动重写，banner 图是一次交叉淡入。
interface Segment {
  frame: number
  value: string
}

const Z_ORDER_HYSTERESIS = 1

// 二分：返回 segments 中最后一个 frame <= idx 的下标；idx 早于首段返回 -1。
function locateSegmentIndex(segments: Segment[], idx: number): number {
  if (idx < segments[0].frame) {
    return -1
  }
  let lo = 0
  let hi = segments.length - 1
  let k = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].frame <= idx) {
      k = mid
      lo = mid + 1
    }
    else {
      hi = mid - 1
    }
  }
  return k
}

// 画一条竖向虚线（刻度引导线）。PIXI Graphics 无原生虚线，按 dash/gap 拆成多段。
function dashedVerticalLine(g: Graphics, x: number, y0: number, y1: number, dash = 5, gap = 7): void {
  for (let y = y0; y < y1; y += dash + gap) {
    g.moveTo(x, y)
    g.lineTo(x, Math.min(y + dash, y1))
  }
}

// domain 下界软 min：每个可见 bar 按 alpha 平滑参与下拉——alpha→0 贡献 max（不下拉）、alpha→1 贡献
// value。取代硬阈值「只看 alpha>=1」：那样 bar「转正」瞬间被突然纳入 min，造成 domain 阶跃、柱宽整体
// 跳变。满屏稳定帧（全 alpha=1）退化为 min(values)，与原行为一致。
function softFrameMin(emerging: RankedData[], max: number): number {
  if (emerging.length === 0) {
    return 0
  }
  let softMin = max
  for (const item of emerging) {
    const eff = max - item.alpha * (max - item.value)
    if (eff < softMin) {
      softMin = eff
    }
  }
  return softMin
}

export class BarChart extends Container {
  maxBarWidth: number
  barComponentMap: Map<string, BarComponent>
  xAxis: Container
  stepLabel: Text
  titleLabel: Text
  subtitleLabel: Text
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
  // 文本变化时间线（按 id）：仅在 textScramble 开启且对应字段启用时构建，否则为 undefined（走原直显路径）。
  private barInfoTimeline?: Map<string, Segment[]>
  private labelTimeline?: Map<string, Segment[]>
  private imageTimeline?: Map<string, Segment[]>
  constructor(data: RankedData[][], config: Config) {
    super()
    this.config = config
    this.data = data
    this.tickWidthMap = new Map()
    this.textWidthCache = new Map()
    const idList = [...new InternSet(data.flat().map(d => d.id))]
    // banner 图按帧可变（imageField 取值随数据变，如 appid 730 在 2023-09 从 CS:GO key 切到 CS2 key）。
    // 预计算每条柱的换图时间线 + 该柱用到的所有图 key→texture，逐帧由 resolveImageState 推出当前/上一张 + 淡入进度。
    this.imageTimeline = this.buildSegmentTimeline(data, d => String(d.raw?.[config.imageField] ?? ''))
    const idImageTextures = new Map<string, Map<string, Texture>>()
    for (const [id, segments] of this.imageTimeline) {
      const texByKey = new Map<string, Texture>()
      for (const { value: key } of segments) {
        const tex = key ? textureMap.get(key) : undefined
        if (tex) {
          texByKey.set(key, tex)
        }
      }
      if (texByKey.size > 0) {
        idImageTextures.set(id, texByKey)
      }
    }
    this.xAxis = new Container()
    this.xAxisTickContainer = new Container()

    // 每帧值域 scale / id 集合 / 最大 step + adaptive 参考尺度，预计算到帧数组。
    const { frameValueScales, frameIdSets, frameMaxSteps, referenceSpan } = this.buildFrameScales(data, config)
    this.referenceSpan = referenceSpan

    this.xAxisLabel = new Text({
      text: config.xAxisLabel,
      style: {
        fontSize: AXIS_TITLE_FONT_SIZE,
        fill: MUTED_LABEL_COLOR,
        fontFamily: config.fontFamily,
      },
    })

    const hasXAxisLabel = Boolean(config.xAxisLabel?.trim())
    const xAxisLabelPaddingUsed = hasXAxisLabel ? this.xAxisLabelPadding : 0
    const xAxisLabelHeight = hasXAxisLabel ? this.xAxisLabel.height : 0

    const { ticksAlphaMap, ticksComponentMap } = this.buildTickComponents(data, config, frameValueScales, xAxisLabelHeight, xAxisLabelPaddingUsed)

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

    // 副标题（数据来源等）：标题下方一行小字，次要色，并入 titleOffset 让正文整体下移。
    const showSubtitle = Boolean(config.subtitle?.trim())
    const subtitleLabel = new Text({
      text: config.subtitle,
      style: {
        fontSize: SUBTITLE_FONT_SIZE,
        fill: MUTED_LABEL_COLOR,
        fontFamily: config.fontFamily,
        align: 'center',
      },
    })
    subtitleLabel.anchor.set(0.5, 0)
    this.subtitleLabel = subtitleLabel

    const titleExtent = showTitle ? Math.max(titleLabel.height, titleFontSize) : 0
    const subtitleBlock = showSubtitle ? subtitleLabel.height + (showTitle ? SUBTITLE_GAP : 0) : 0
    let titleOffset = (showTitle || showSubtitle) ? titleExtent + subtitleBlock + TITLE_PADDING : 0
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
    // 圆角（只作用于柱子右端）：显式 borderRadius 优先；未设置（0）时按柱高自适应一个克制的小圆角。
    const effRadius = config.borderRadius > 0
      ? config.borderRadius
      : Math.min(Math.max(config.barHeight * 0.14, 2), 7)
    const labelMap = new Map<string, string>()
    for (const item of data.flat()) {
      if (!labelMap.has(item.id)) {
        labelMap.set(item.id, item.label)
      }
    }
    // 左侧 label 字号与数值标签对齐（0.7×barHeight），不再用满柱高——满柱高会让 label 比数字明显
    // 粗大、布局笨重。注意它只作用于左侧 label：柱上 value/barInfo 仍由基准 fontSize(=barHeight) 派生，
    // 不能把这个缩小值当成 BarComponent.fontSize 传进去（否则 value 会被 getValueLabelFontSize 二次缩小）。
    // 留白宽度也按同一字号算，避免多余左边距。
    const labelFontSize = getValueLabelFontSize(config.barHeight)
    const maxLabelWidth = config.showLabel ? this.getMaxLabelWidth([...labelMap.values()], config, labelFontSize) : 0

    const barComponentMap = new Map<string, BarComponent>(idList.map((id) => {
      const comp = new BarComponent({
        x: 0,
        y: 0,
        width: 0,
        height: config.barHeight,
        label: labelMap.get(id) ?? '',
        fontSize: config.barHeight, // 基准字号：柱上 value/barInfo 由它派生（0.7×barHeight）
        leftLabelFontSize: labelFontSize, // 左侧 label 单独用缩小值（0.7×barHeight），不影响柱上文本
        colorLabel: 0xFF_FF_FF,
        leftLabelPadding: config.leftLabelPadding,
        barInfoPadding: config.barInfoPadding,
        barInfoStyle: config.barInfoStyle,
        imageTextures: idImageTextures.get(id), // 该柱用到的所有 banner（key→texture）；逐帧切 .texture + 交叉淡入
        leftLabelWidth: maxLabelWidth,
        showLabel: config.showLabel,
        valueLabelPadding: config.valueLabelPadding,
        radius: effRadius,
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
    // 与标题一致：对整个画布居中（xAxis 容器本身有 axisOffset 的横向偏移要扣掉）
    this.xAxisLabel.position.set(config.width / 2 - axisOffset, 0)
    this.xAxisLabel.visible = hasXAxisLabel
    this.xAxisLabel.renderable = hasXAxisLabel

    titleOffset = (showTitle || showSubtitle) ? titleExtent + subtitleBlock + TITLE_PADDING : 0
    titleLabel.anchor.set(0.5, 0)
    titleLabel.position.set(config.width / 2, 0)
    titleLabel.visible = showTitle
    titleLabel.renderable = showTitle
    subtitleLabel.position.set(config.width / 2, titleExtent + (showTitle ? SUBTITLE_GAP : 0))
    subtitleLabel.visible = showSubtitle
    subtitleLabel.renderable = showSubtitle

    smoothTicksAlpha(ticksAlphaMap, config)
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
    this.addChild(subtitleLabel)
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

    // 预计算文本变化时间线：让 update(frame) 能纯函数地推出「距上次变化多少帧 → 扰动进度」，
    // 实时播放 / Remotion 逐帧渲染 / 进度条任意跳转一致可复现（避免依赖逐帧累积的可变状态）。
    if (config.textScrambleEnabled) {
      if (config.textScrambleFields.includes('barInfo')) {
        this.barInfoTimeline = this.buildSegmentTimeline(data, (d, i, frame) => String(config.getBarInfo(d, i, frame) ?? ''))
      }
      // label 隐藏时不渲染左标签，省去这份构建。逐帧取 perFrameLabel（支持中途改名），其变化点即触发重写动画。
      if (config.showLabel && config.textScrambleFields.includes('label')) {
        this.labelTimeline = this.buildSegmentTimeline(data, d => this.perFrameLabel(d))
      }
    }

    if (config.showStepLabel) {
      stepLabel.anchor.set(1, 1)
      stepLabel.position.set(config.width, config.height)
    }
    else {
      stepLabel.renderable = false
    }
  }

  // 预计算每帧值域 scale / id 集合 / 最大 step，以及 adaptive 的参考尺度（屏内首尾差中位数）。
  // 上界 max 看渐入 bar (alpha>0)；下界 min 用 alpha 加权软 min（见 softFrameMin），让 bar 对下界的
  // 下拉随 alpha 平滑增长，避免「转正(alpha 跨 1)」瞬间硬纳入 min 造成的 domain 阶跃（柱宽整体跳变）。
  // 平滑只用来让值域变化更顺，最终 domain 仍包住当帧真实 max（否则上升中的榜首会被 clamp）。
  private buildFrameScales(data: RankedData[][], config: Config) {
    const frameValueScales: ScaleLinear<number, number>[] = []
    const frameIdSets: InternSet<string>[] = []
    const frameMaxSteps: Array<number | undefined> = []
    const frameMinValues: number[] = []
    const frameMaxValues: number[] = []

    for (const [i, d] of data.entries()) {
      const emerging = d.filter(item => item.alpha > 0)
      const [, max] = extent(emerging, item => item.value)
      const safeMax = Number.isFinite(max) ? Number(max) : 0
      frameMinValues[i] = softFrameMin(emerging, safeMax)
      frameMaxValues[i] = safeMax
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
    // adaptive 参考尺度：屏内首尾差距的中位数（与 DataProcessor.buildBaselineScale 共用 computeReferenceSpan）。
    const spans: number[] = []
    for (let i = 0; i < data.length; i += 1) {
      spans.push((smoothedMaxValues[i] ?? 0) - (smoothedMinValues[i] ?? 0))
    }
    const referenceSpan = computeReferenceSpan(spans)
    const adaptiveOptions = {
      referenceSpan,
      minRatio: config.valueScaleMinRatio,
      maxRatio: config.valueScaleMaxRatio,
    }
    for (let i = 0; i < data.length; i += 1) {
      const realMin = frameMinValues[i] ?? 0
      const realMax = frameMaxValues[i] ?? 0
      // domain 下界不高于当前帧真实 min（对称于下面 maxValue 的兜底）：平滑会让 min 漂到真实值之上，
      // 当稳定条目极少（如早期单一公司独大）时整个 domain 浮在数据上方，最高柱被算成负宽度而塌缩——
      // 表现为相邻帧柱宽 99%→0% 的突变。
      let minValue = Math.min(smoothedMinValues[i] ?? realMin, realMin)
      // domain 上界不低于当前帧真实 max：平滑滞后会把上升中的榜首 clamp，使柱长对应的刻度 < 数值标签。
      const maxValue = Math.max(smoothedMaxValues[i] ?? 0, realMax)
      // 真实数据只有单一 distinct 值（单一公司独大）时 span=0，自适应无可缩放跨度，domain 塌成点：
      // 榜首柱宽 ill-defined、入场柱恒 0 宽（只剩数字）、相邻帧 99%→0% 突变。仅此退化情形用
      // referenceSpan 撑一个稳定宽度（多柱帧 realMax>realMin，走原自适应、不受影响）。
      if (realMax - realMin < 1e-9 && referenceSpan > 0) {
        minValue = Math.min(minValue, maxValue - referenceSpan * config.valueScaleMinRatio)
      }
      frameValueScales[i] = getValueScale(config.valueScaleType, minValue, maxValue, config.valueScaleDelta, adaptiveOptions)
    }

    // domain 下界二次平滑：min 序列的 blur 已削掉连续抖动，但 adaptive 变换 +「最后一名换人」仍会在
    // 下界留折点，逐帧看是一顿一顿。对下界序列再 blur 一次钝化升降两个方向（上界=榜首不动）。adaptive
    // 给的下界本就远低于真实最低值（留了 margin），二次平滑的滞后不足以让下界浮到数据之上 → 最低柱不
    // 会负宽塌缩（实测 0 浮空帧）。
    if (smoothingRadius > 0 && frameValueScales.length > 1) {
      const loSeries = frameValueScales.map(s => s.domain()[0])
      blur(loSeries, smoothingRadius)
      for (let i = 0; i < frameValueScales.length; i += 1) {
        frameValueScales[i] = scaleLinear().domain([loSeries[i], frameValueScales[i].domain()[1]]).range([0, 1])
      }
    }

    return { frameValueScales, frameIdSets, frameMaxSteps, referenceSpan }
  }

  // 构建刻度组件（文字 + 引导线）与每帧 alpha 序列；副作用：写入 tickLabelHeight / tickWidthMap，
  // 并把刻度容器挂到 xAxisTickContainer。
  private buildTickComponents(
    data: RankedData[][],
    config: Config,
    frameValueScales: ScaleLinear<number, number>[],
    xAxisLabelHeight: number,
    xAxisLabelPaddingUsed: number,
  ) {
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
            text: config.getTickLabel(tick),
            style: {
              fontSize: config.tickLabelFontSize,
              fill: MUTED_LABEL_COLOR,
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
            color: TICK_LINE_COLOR,
          })

          const tickBounds = tickText.getBounds()
          const tickWidth = tickBounds.width

          const tickLabelHeight = tickBounds.height
          this.tickLabelHeight = tickLabelHeight
          dashedVerticalLine(tickLine, tickWidth / 2, this.tickLabelHeight, config.height - xAxisLabelHeight - xAxisLabelPaddingUsed)
          tickLine.stroke()

          tickComp.position.set(-tickWidth / 2, 0)
          ticksComponentMap.set(tick, tickComp)
          this.xAxisTickContainer.addChild(tickComp)
          this.tickWidthMap.set(tick, tickWidth)
        }
      }
    }

    return { ticksAlphaMap, ticksComponentMap }
  }

  private getMaxLabelWidth(labels: string[], config: Config, fontSize: number) {
    if (labels.length === 0) {
      return 0
    }
    const style = new TextStyle({
      fontFamily: config.fontFamily,
      fontSize,
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

  // 按 id 归集某文本维度的「变化点」：逐帧取文本，与该 id 上次取值不同才记一段。空间 O(变化次数)，
  // 常量文本（如 ticker、label '-'）只占一段，永不触发动画。
  // 按 id 归集某个逐帧字符串值（label / barInfo / banner 图 key）的「变化点」：逐帧取值，与上次不同才记一段。
  // 绝大多数柱该值恒定，只占一段；仅原地改名/换图的（如 appid 730）会有 2 段。
  private buildSegmentTimeline(
    data: RankedData[][],
    getValue: (d: RankedData, i: number, frame: number) => string,
  ): Map<string, Segment[]> {
    const timeline = new Map<string, Segment[]>()
    const last = new Map<string, string>()
    for (const [frame, items] of data.entries()) {
      for (const [i, d] of items.entries()) {
        const value = getValue(d, i, frame)
        if (last.get(d.id) === value) {
          continue
        }
        last.set(d.id, value)
        let segments = timeline.get(d.id)
        if (!segments) {
          segments = []
          timeline.set(d.id, segments)
        }
        segments.push({ frame, value })
      }
    }
    return timeline
  }

  // 逐帧左侧 label：优先取 raw[labelField]（允许同一条柱中途改名——身份由 id 维持、显示名随数据变，
  // 如 appid 730：2023 前「反恐精英：全球攻势」、之后「反恐精英 2」原地重写），回退到固定 d.label。
  // labelField 为空（label 配成函数）或该帧 raw 缺列时退回 d.label，行为与改动前一致。
  private perFrameLabel(d: RankedData): string {
    const field = this.config.labelField
    const v = field ? d.raw?.[field] : undefined
    return String(v ?? d.label ?? '')
  }

  // 给定帧 idx，推出某 id 当前应显示的文本：处于某次变化后的过渡窗口内则返回扰动中间态，否则返回定型文本。
  private resolveScrambleText(timeline: Map<string, Segment[]>, id: string, idx: number): string {
    const segments = timeline.get(id)
    if (!segments || segments.length === 0) {
      return ''
    }
    const k = locateSegmentIndex(segments, idx)
    // k<0：尚未出现（一般 alpha=0 不显示）；k===0：首段无前驱，首次出现不扰动。两者均给首段文本。
    if (k <= 0) {
      return segments[0].value
    }
    const seg = segments[k]
    const dur = this.config.textScrambleDurationFrames
    const framesSince = idx - seg.frame
    if (framesSince >= dur) {
      return seg.value
    }
    const progress = dur > 0 ? framesSince / dur : 1
    return scrambleText(segments[k - 1].value, seg.value, progress, framesSince, id, this.config.textScrambleChars)
  }

  // 给定帧 idx，推出某 id 当前 banner：定型时只有 key；处于换图后的淡入窗口内则额外给 prevKey + fade(0→1)。
  private resolveImageState(id: string, idx: number): { key?: string, prevKey?: string, fade: number } {
    const segments = this.imageTimeline?.get(id)
    if (!segments || segments.length === 0) {
      return { fade: 1 }
    }
    const k = locateSegmentIndex(segments, idx)
    // k<0：尚未出现；k===0：首段无前驱，首次出现不淡入（随入场 alpha 即可）。两者均给首段图、不淡入。
    if (k <= 0) {
      return { key: segments[0].value, fade: 1 }
    }
    const seg = segments[k]
    const dur = this.config.imageCrossfadeDurationFrames
    const framesSince = idx - seg.frame
    if (framesSince >= dur) {
      return { key: seg.value, fade: 1 }
    }
    return { key: seg.value, prevKey: segments[k - 1].value, fade: dur > 0 ? framesSince / dur : 1 }
  }

  update(idx: number) {
    if (idx >= this.data.length) {
      return
    }
    const config = this.config
    const data = this.data[idx]
    let valueScale = this.frameValueScales[idx]
    if (!valueScale) {
      // 与构造期一致：上界看渐入 bar、下界用 alpha 加权软 min（见上方主路径注释）。
      const emerging = data.filter(item => item.alpha > 0)
      const [, mx] = extent(emerging, d => d.value)
      const max = Number.isFinite(mx) ? Number(mx) : 0
      const min = softFrameMin(emerging, max)
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
      // 不透明度优先取 applyVelocity 预算好的 renderAlpha：满榜入场/退场柱由纵向位置（穿越底边带）淡变，
      // 未满榜入场柱则就地随 enter ramp 淡入（不靠穿带）。缺省（未经 applyVelocity 的数据）回退到底边带公式：
      // 可见区最下面一行（rank=topN-1）及以上恒 1，下沉到停车位（rank=topN）的一格行程内线性衰减到 0。
      const yAlpha = d.renderAlpha ?? Math.max(0, Math.min(1, config.topN - d.blurRank))
      // barInfo / label 变化时走「重写」动画（时间线已预计算）；未启用则原样直显。
      const barInfo = this.barInfoTimeline
        ? this.resolveScrambleText(this.barInfoTimeline, d.id, idx)
        : config.getBarInfo(d, i, idx)
      const label = this.labelTimeline
        ? this.resolveScrambleText(this.labelTimeline, d.id, idx)
        : this.perFrameLabel(d)
      // banner：定型时给当前 key；换图淡入窗口内额外给 prevKey + fade，由 BarComponent 双 sprite 交叉淡入。
      const { key: imageKey, prevKey: imagePrevKey, fade: imageFade } = this.resolveImageState(d.id, idx)
      bar.update({
        y: d.blurRank * (config.barHeight + config.barGap),
        label,
        width: barWidth,
        alpha: yAlpha,
        color: config.getColor(d),
        valueLabel: canShowValue ? valueText : '',
        extraValueLabel: canShowValue ? extraText : '',
        barInfo,
        showLabel: config.showLabel,
        imageKey,
        imagePrevKey,
        imageFade,
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
