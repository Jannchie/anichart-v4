import type { Texture } from 'pixi.js'
import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { getExtraValueLabelFontSize, getValueLabelFontSize } from './utils/labelFonts'

export const EXTRA_VALUE_LABEL_PADDING = 8

// reverse 模式下图片相对柱高的缩放，留出与文字并排的视觉余量。
const REVERSE_IMAGE_SCALE = 0.7

// 把 0xRRGGBB 朝白（amt>0）或黑（amt<0）混合，|amt| 为混合比例。用于数值标签提亮。
function shade(color: number, amt: number): number {
  const r = (color >> 16) & 0xFF
  const g = (color >> 8) & 0xFF
  const b = color & 0xFF
  const target = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  const nr = Math.round((target - r) * p + r)
  const ng = Math.round((target - g) * p + g)
  const nb = Math.round((target - b) * p + b)
  return (nr << 16) | (ng << 8) | nb
}

// 只圆右侧两角：柱子从左侧轴线生长，右端做圆头，左端贴轴保持直角。
// 调用方负责随后 fill()。
function drawRightRoundedBar(g: Graphics, w: number, h: number, r: number): void {
  g.clear()
  const rr = Math.max(0, Math.min(r, w, h / 2))
  if (rr <= 0) {
    g.rect(0, 0, w, h)
    return
  }
  g.moveTo(0, 0)
  g.lineTo(w - rr, 0)
  g.arcTo(w, 0, w, rr, rr) // 右上角
  g.lineTo(w, h - rr)
  g.arcTo(w, h, w - rr, h, rr) // 右下角
  g.lineTo(0, h)
  g.closePath()
}

interface BarItemSettings {
  x: number
  y: number
  width: number
  height: number
  label: string
  color: number
  fontFamily: string
  fontSize: number // 基准字号（=柱高）：柱上 value / barInfo 由它派生（getValueLabelFontSize）
  leftLabelFontSize?: number // 左侧 label 字号，独立于 fontSize（默认跟随 fontSize）
  colorLabel: number
  barInfo: string
  colorBarInfo: number
  leftLabelPadding: number
  barInfoPadding: number
  barInfoStyle: 'default' | 'reverse'
  valueLabelPadding: number
  valueLabel: string
  extraValueLabel: string
  leftLabelWidth?: number
  alpha: number
  radius: number
  imageTextures?: Map<string, Texture> // 该柱可用的所有 banner（key→texture）；逐帧按 imageKey 切 .texture
  imageKey?: string // 当前帧 banner 的 key（imageField 取值）
  imagePrevKey?: string // 交叉淡入窗口内的上一张 banner key（垫在底层）
  imageFade?: number // 当前 banner 的淡入进度 0→1（1=完全显示，无淡入）
  autoBarHeight: boolean
  showLabel: boolean

}

export class BarComponent extends Container {
  barItemMask: Graphics
  leftLabel: Text
  barInfoContainer: Container
  barInfoText: Text
  valueLabel: Text
  settings: BarItemSettings
  bar: Container
  imageTop?: Sprite // 当前 banner（交叉淡入时在上层，alpha=fade）
  imageUnder?: Sprite // 上一张 banner（交叉淡入时垫底，alpha=1）
  private imageTextures?: Map<string, Texture>
  private lastTopKey?: string
  private lastUnderKey?: string
  barItem: Graphics
  extraValueLabel: Text
  valueContainer: Container
  private lastLabelText = ''
  private lastLabelWidth = 0
  private lastLabelHeight = 0
  private lastBarWidth = -1
  private lastBarHeight = -1
  private lastBarColor = Number.NaN
  private lastBarRadius = -1
  constructor(settings: Partial<BarItemSettings> = {}) {
    super()
    const defaultSettings = {
      x: 0,
      y: 0,
      width: 100,
      height: 48,
      label: 'Label',
      barInfo: '',
      color: 0x15_15_15,
      fontFamily: 'Berkeley Mono',
      fontSize: 20,
      colorLabel: 0xFF_FF_FF,
      colorBarInfo: 0xFF_FF_FF,
      leftLabelPadding: 5,
      barInfoPadding: 10,
      valueLabelPadding: 5,
      valueLabel: '0',
      alpha: 1,
      radius: 4,
      barInfoStyle: 'default',
      autoBarHeight: true,
      showLabel: true,
    }
    settings = Object.assign(defaultSettings, settings)
    this.settings = settings as BarItemSettings
    this.bar = new Container()
    this.barItemMask = new Graphics()
    this.barItem = new Graphics()
    this.leftLabel = new Text({
      style: {
        fontFamily: settings.fontFamily,
        fontSize: settings.leftLabelFontSize ?? settings.fontSize,
        fill: settings.colorLabel,
      },
    })
    this.leftLabel.anchor.set(1, 0.5)

    this.barInfoContainer = new Container()
    const valueFontSize = getValueLabelFontSize(settings.fontSize ?? 12)
    const extraFontSize = getExtraValueLabelFontSize(valueFontSize)

    this.barInfoText = new Text({
      style: {
        fontFamily: settings.fontFamily,
        fontSize: valueFontSize,
        fill: settings.colorBarInfo,
        fontWeight: 'bold',
        // 更柔和的投影：几乎无偏移、模糊更大，只为在彩色柱面上保证可读性，去掉老式硬投影。
        dropShadow: {
          color: 0x00_00_00,
          alpha: 0.35,
          blur: 4,
          distance: 1,
        },
      },
    })
    this.barInfoText.anchor.set(0, 0.5)

    this.valueLabel = new Text({
      style: {
        fontFamily: settings.fontFamily,
        fontSize: valueFontSize,
        fill: settings.colorLabel,
        dropShadow: {
          color: 0x00_00_00,
          alpha: 0.35,
          blur: 4,
          distance: 1,
        },
      },
    })
    this.valueLabel.anchor.set(0, 0.5)
    this.extraValueLabel = new Text({
      style: {
        fontSize: extraFontSize,
        fill: 0xAA_AA_AA,
        fontFamily: settings.fontFamily,
      },
    })
    this.extraValueLabel.anchor.set(0, 0.5)
    this.valueContainer = new Container()
    this.valueContainer.addChild(this.valueLabel, this.extraValueLabel)
    this.addChild(this.bar)
    this.bar.addChild(this.barItem, this.barItemMask, this.valueContainer)
    this.barInfoContainer.addChild(this.barInfoText)
    this.barInfoContainer.mask = this.barItemMask
    this.bar.addChild(this.barInfoContainer)
    this.addChild(this.bar, this.leftLabel)
    if (settings.imageTextures && settings.imageTextures.size > 0) {
      this.imageTextures = settings.imageTextures
      // 两张 sprite 常驻：under 先加（底层）、top 后加（上层）；纹理逐帧按 key 切，避免每帧重建 sprite。
      this.imageUnder = new Sprite()
      this.imageTop = new Sprite()
      this.imageUnder.visible = false
      this.imageTop.visible = false
      this.barInfoContainer.addChild(this.imageUnder, this.imageTop)
    }
  }

  // 把一张 banner sprite 按 barInfoStyle 缩放并定位（top/under 共用，二者完全重叠以做交叉淡入）。
  private layoutImageSprite(sprite: Sprite, height: number, style: 'default' | 'reverse', barInfoTextWidth: number, barInfoPadding: number): void {
    const tex = sprite.texture
    const aspectRatio = tex.height > 0 ? tex.width / tex.height : 1
    if (style === 'reverse') {
      sprite.height = height * REVERSE_IMAGE_SCALE
      sprite.width = height * REVERSE_IMAGE_SCALE * aspectRatio
      sprite.position.set(0, height / 2 - sprite.height / 2)
    }
    else {
      sprite.height = height
      sprite.width = height * aspectRatio
      sprite.position.set(barInfoTextWidth + barInfoPadding, height / 2 - sprite.height / 2)
    }
  }

  update(barItemSettings: Partial<BarItemSettings>) {
    Object.assign(this.settings, barItemSettings)
    if (this.settings.alpha === 0) {
      this.renderable = false
      return
    }
    else {
      this.renderable = true
    }
    const barInfoContainer = this.barInfoContainer
    const barInfoText = this.barInfoText
    const barInfoPadding = this.settings.barInfoPadding ?? 5
    barInfoText.text = this.settings.barInfo
    const width = this.settings.width ?? 0
    const height = this.settings.height ?? 0

    // banner 交叉淡入：imageTop=当前图（alpha=fade），imageUnder=上一张（alpha=1 垫底）；二者完全重叠，
    // top 由透明渐显盖住 under 即完成换图。绝大多数柱 fade 恒为 1（无换图），只显示 top。
    const textures = this.imageTextures
    const imageKey = this.settings.imageKey
    const imageFade = this.settings.imageFade ?? 1
    const barInfoStyle = this.settings.barInfoStyle
    const curTex = (textures && imageKey) ? textures.get(imageKey) : undefined
    let imageWidth = 0
    if (this.imageTop && curTex) {
      if (this.lastTopKey !== imageKey) {
        this.imageTop.texture = curTex
        this.lastTopKey = imageKey
      }
      this.imageTop.visible = true
      this.imageTop.alpha = imageFade
      this.layoutImageSprite(this.imageTop, height, barInfoStyle, barInfoText.width, barInfoPadding)
      imageWidth = this.imageTop.width
      const prevKey = this.settings.imagePrevKey
      const prevTex = (textures && prevKey) ? textures.get(prevKey) : undefined
      if (this.imageUnder && prevTex && imageFade < 1) {
        if (this.lastUnderKey !== prevKey) {
          this.imageUnder.texture = prevTex
          this.lastUnderKey = prevKey
        }
        this.imageUnder.visible = true
        this.imageUnder.alpha = 1
        this.layoutImageSprite(this.imageUnder, height, barInfoStyle, barInfoText.width, barInfoPadding)
      }
      else if (this.imageUnder) {
        this.imageUnder.visible = false
      }
    }
    else {
      if (this.imageTop) {
        this.imageTop.visible = false
      }
      if (this.imageUnder) {
        this.imageUnder.visible = false
      }
    }
    barInfoContainer.position.set(width - barInfoText.width - imageWidth - barInfoPadding, 0)
    barInfoText.position.set(barInfoStyle === 'reverse' ? imageWidth + barInfoPadding : 0, height / 2)

    let leftLabelWidth = this.settings.leftLabelWidth

    const leftLabel = this.leftLabel
    const barItemMask = this.barItemMask
    const barItem = this.barItem
    const leftLabelPadding = this.settings.leftLabelPadding ?? 5
    const valueLabelPadding = this.settings.valueLabelPadding ?? 5
    const label = this.settings.label
    const valueLabel = this.settings.valueLabel
    const color = this.settings.color
    const showLabel = this.settings.showLabel ?? true

    leftLabel.renderable = showLabel
    leftLabel.visible = showLabel

    const x = this.settings.x
    const y = this.settings.y
    const nextLabel = label ?? ''
    let labelChanged = false
    if (label !== undefined && nextLabel !== this.lastLabelText) {
      leftLabel.text = nextLabel
      this.lastLabelText = nextLabel
      labelChanged = true
    }

    if (width !== undefined && height !== undefined) {
      if (showLabel) {
        if (labelChanged || this.lastLabelWidth === 0 || this.lastLabelHeight === 0) {
          const bounds = leftLabel.getBounds()
          this.lastLabelWidth = bounds.width
          this.lastLabelHeight = bounds.height
        }
        if (!leftLabelWidth) {
          leftLabelWidth = this.lastLabelWidth
        }
        leftLabel.position.set(0, height / 2)
      }
      else {
        leftLabelWidth = 0
        leftLabel.position.set(0, 0)
      }
      const barX = showLabel ? leftLabelPadding : 0
      this.bar.position.set(barX, 0)
      const barWidth = width
      const radius = this.settings.radius ?? 0
      const colorChanged = color !== this.lastBarColor

      if (colorChanged) {
        // 数值标签用「柱色的提亮版」，比纯白更协调、仍清晰。
        this.valueLabel.style.fill = shade(color, 0.55)
      }

      const shouldRedraw = barWidth !== this.lastBarWidth
        || height !== this.lastBarHeight
        || colorChanged
        || radius !== this.lastBarRadius

      if (shouldRedraw) {
        drawRightRoundedBar(barItemMask, barWidth, height, radius)
        barItemMask.fill(color)
        drawRightRoundedBar(barItem, barWidth, height, radius)
        barItem.fill(color)

        this.lastBarWidth = barWidth
        this.lastBarHeight = height
        this.lastBarColor = color
        this.lastBarRadius = radius
      }
    }
    this.valueLabel.text = valueLabel
    this.valueLabel.position.set(width + valueLabelPadding, height / 2)
    this.extraValueLabel.text = this.settings.extraValueLabel ?? ''
    this.extraValueLabel.position.set(this.valueLabel.x + this.valueLabel.width + EXTRA_VALUE_LABEL_PADDING, height / 2)
    this.position.set(x, y)
    this.alpha = this.settings.alpha
    // 标签透明度只跟随整体入场/出场（settings.alpha），不再与柱宽挂钩——此前柱宽趋零时把左右标签
    // 一起淡出（widthFade = width/height），会让短柱（榜尾 / 小国）的国名和数值半透明、观感差。
    // 现固定全不透明；入场期的「无柱浮动标签」由 settings.alpha 的整体淡入兜底。
    this.valueContainer.alpha = 1
    if (showLabel) {
      this.leftLabel.alpha = 1
    }
  }
}
