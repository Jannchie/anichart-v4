import type { Sprite } from 'pixi.js'
import { Container, Graphics, Text } from 'pixi.js'
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
  fontSize: number
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
  image?: Sprite
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
  image?: Sprite
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
        fontSize: settings.fontSize,
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
    if (settings.image) {
      this.image = settings.image
      this.barInfoContainer.addChild(this.image)
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

    const image = this.settings.image
    if (image) {
      const aspectRatio = image.width / image.height
      switch (this.settings.barInfoStyle) {
        case 'default': {
          image.height = this.settings.height
          image.width = this.settings.height * aspectRatio
          break
        }
        case 'reverse': {
          image.height = this.settings.height * REVERSE_IMAGE_SCALE
          image.width = this.settings.height * aspectRatio * REVERSE_IMAGE_SCALE
        }
      }
      barInfoContainer.position.set(width - barInfoText.width - image.width - barInfoPadding, 0)
    }
    else {
      barInfoContainer.position.set(width - barInfoText.width - barInfoPadding, 0)
    }
    switch (this.settings.barInfoStyle) {
      case 'default': {
        barInfoText.position.set(0, height / 2)
        if (image) {
          image.position.set(barInfoText.width + barInfoPadding, height / 2 - image.height / 2)
        }
        break
      }
      case 'reverse': {
        barInfoText.position.set((image?.width ?? 0) + barInfoPadding, height / 2)
        if (image) {
          image.position.set(0, height / 2 - image.height / 2)
        }
      }
    }

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
    // 柱宽趋零时数值标签随之淡出，避免「只剩数字、没有柱子」的孤立标签：条目少或榜尾入场时
    // value≈当前最短 → width≈0，而 bar 整体仍不透明。柱宽达到约一个柱高即完全显示。
    this.valueContainer.alpha = Math.max(0, Math.min(1, width / Math.max(1, height)))
  }
}
