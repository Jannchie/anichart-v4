import type { Sprite } from 'pixi.js'
import { BitmapText, Container, Graphics, Text } from 'pixi.js'

export const EXTRA_VALUE_LABEL_PADDING = 20

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
  colorBar: number
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
  tickNumber?: number
  autoBarHeight: boolean
  showLabel: boolean

}

export class BarComponent extends Container {
  barItemMask: Graphics
  leftLabel: Text
  barInfoContainer: Container
  barInfoText: BitmapText
  valueLabel: BitmapText
  settings: BarItemSettings
  bar: Container
  image?: Sprite
  barItem: Graphics
  extraValueLabel: BitmapText
  valueContainer: Container
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
      fontFamily: 'Sarasa Mono SC',
      fontSize: 20,
      colorLabel: 0xFF_FF_FF,
      colorBarInfo: 0xFF_FF_FF,
      leftLabelPadding: 5,
      barInfoPadding: 10,
      valueLabelPadding: 5,
      valueLabel: '0',
      alpha: 1,
      radius: 4,
      tickNum: 8,
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

    this.barInfoContainer = new Container()
    this.barInfoText = new BitmapText({
      style: {
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize! - 12, // TODO: a magic number
        fill: settings.colorBarInfo,
        dropShadow: {
          color: 0x00_00_00,
          alpha: 0.5,
          blur: 2,
          distance: 4,
        },
      },
    })

    this.valueLabel = new BitmapText({
      style: {
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize! - 12, // TODO: a magic number
        fill: settings.colorLabel,
        dropShadow: {
          color: 0x00_00_00,
          alpha: 0.5,
          blur: 2,
          distance: 4,
        },
      },
    })
    this.extraValueLabel = new BitmapText({
      style: {
        fontSize: 32,
        fill: 0xAA_AA_AA,
        fontFamily: settings.fontFamily,
      },
    })
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
      const scale = 0.7
      switch (this.settings.barInfoStyle) {
        case 'default': {
          image.height = this.settings.height
          image.width = this.settings.height * aspectRatio
          break
        }
        case 'reverse': {
          // TODO: 0.8 is a magic scale number
          image.height = this.settings.height * scale
          image.width = this.settings.height * aspectRatio * scale
        }
      }
      barInfoContainer.position.set(width - barInfoText.width - image.width - barInfoPadding, 0)
    }
    else {
      barInfoContainer.position.set(width - barInfoText.width - barInfoPadding, 0)
    }
    switch (this.settings.barInfoStyle) {
      case 'default': {
        barInfoText.position.set(0, height / 2 - barInfoText.height / 2)
        if (image) {
          image.position.set(barInfoText.width + barInfoPadding, 0)
        }
        break
      }
      case 'reverse': {
        barInfoText.position.set((image?.width ?? 0) + barInfoPadding, height / 2 - barInfoText.height / 2)
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
    if (label !== undefined) {
      leftLabel.text = label
    }

    if (width !== undefined && height !== undefined) {
      if (showLabel) {
        const leftLabelBounds = leftLabel.getBounds()
        if (!leftLabelWidth) {
          leftLabelWidth = leftLabelBounds.width
        }
        leftLabel.position.set(-leftLabelBounds.width, (height - leftLabelBounds.height) / 2)
      }
      else {
        leftLabelWidth = 0
        leftLabel.position.set(0, 0)
      }
      const barX = showLabel ? leftLabelPadding : 0
      this.bar.position.set(barX, 0)
      const barWidth = width

      barItemMask.clear()
      if (this.settings.radius) {
        barItemMask.roundRect(0, 0, barWidth, height, this.settings.radius)
      }
      else {
        barItemMask.rect(0, 0, barWidth, height)
      }
      barItemMask.fill(color)

      barItem.clear()
      if (this.settings.radius) {
        barItem.roundRect(0, 0, barWidth, height, this.settings.radius)
      }
      else {
        barItem.rect(0, 0, barWidth, height)
      }
      barItem.fill(color)
    }
    this.valueLabel.text = valueLabel
    this.valueLabel.position.set(width + valueLabelPadding, (height - this.valueLabel.height) / 2)
    this.extraValueLabel.text = this.settings.extraValueLabel ?? ''
    // TODO: 20 is a magic padding number
    this.extraValueLabel.position.set(this.valueLabel.x + this.valueLabel.width + EXTRA_VALUE_LABEL_PADDING, (height - this.extraValueLabel.height) / 2)
    this.position.set(x, y)
    this.alpha = this.settings.alpha
  }
}
