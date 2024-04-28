import { Application, Assets, BitmapText, Container, Sprite, Text } from 'pixi.js'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Config } from '../../src/Config'
import { DataProcessor } from '../../src/DataProcessor'
import { BarChart } from '../../src/BarChart'
import type { Data } from '../../src/Data'
import { imageMap, textureMap } from '../../src/main'

function loadImageMap() {
  // 对于每个国家编码，从 flagpack/flags/4x3/*.svg 下加载国旗图片
  imageMap.set('cn', staticFile('flagpack/flags/4x3/cn.svg'))
  imageMap.set('jp', staticFile('flagpack/flags/4x3/jp.svg'))
  imageMap.set('kr', staticFile('flagpack/flags/4x3/kr.svg'))
  imageMap.set('tw', staticFile('flagpack/flags/4x3/cn.svg'))
  imageMap.set('坂田荣男', staticFile('go/img/Eio_Sakata.jpg'))
  imageMap.set('桥本宇太郎', staticFile('go/img/Hashimoto-Utaro-1.jpg'))
  imageMap.set('林海峰', staticFile('go/img/Lam_Hoi_Fung.png'))
  imageMap.set('藤泽秀行', staticFile('go/img/Fujisawa_Hideyuki.png'))
  imageMap.set('李昌镐', staticFile('go/img/Lee_Chang-ho.png'))
  imageMap.set('赵治勋', staticFile('go/img/Cho_Chikun.png'))
  imageMap.set('小林光一', staticFile('go/img/Kobayashi_Koichi.png'))
  imageMap.set('柯洁', staticFile('go/img/Ke_jie.jpg'))
  imageMap.set('朴廷桓', staticFile('go/img/Park_Jung-hwan.png'))
  imageMap.set('古力', staticFile('go/img/Gu_Li.png'))
  imageMap.set('加藤正夫', staticFile('go/img/Kato_Masao.png'))
  imageMap.set('曹薰铉', staticFile('go/img/Cho_Hun-hyun.jpg'))
  imageMap.set('李世石', staticFile('go/img/Lee_Sedol.jpg'))
  imageMap.set('时越', staticFile('go/img/Shi_Yue.jpg'))
  imageMap.set('申真谞', staticFile('go/img/Shin_Jinseo.png'))
}
loadImageMap()
const formatNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const config = new Config({
  idField: 'player_name',
  labelField: '-',
  imageField: 'country',
  stepField: 'date',
  valueField: 'rating',
  valueScaleType: 'from-delta',
  valueScaleDelta: 350,
  colorField: 'country',
  showStepLabel: false,
  totalDurationSec: 180,
  maxRetentionTimeSec: 18,
  swapDurationSec: 0.5,
  barHeight: 36,
  y: 1080 - 800,
  height: 800,
  topN: 12,
  barInfoStyle: 'reverse',
  xAxisLabel: 'WHR (全历史等级分算法)',
  barGap: 8,
  getValueExtra: (d) => {
    return `${formatNumber.format(d.raw.win_count)}-${formatNumber.format(d.raw.loss_count)} ${Math.floor(100 * Number(d.raw.win_count) / (Number(d.raw.loss_count) + Number(d.raw.win_count)))}%`
  },
  getBarInfo: (d) => {
    const birthday = d.raw.birth_date
    const step = d.step
    const birthStep = dayjs(birthday).valueOf()
    const age = Math.floor((step - birthStep) / 1000 / 60 / 60 / 24 / 365)
    return `${d.id}(${age})`
  },
  getValueLabel: (d) => {
    return `${formatNumber.format(d.value)} `
  },
})
const app = new Application()

async function init({
  fps,
  width,
  height,
  durationInFrames,
}: {
  fps: number
  width: number
  height: number
  durationInFrames: number
}) {
  config.fps = fps
  config.canvasWidth = width
  config.canvasHeight = height
  config.totalDurationSec = durationInFrames / fps - config.swapDurationSec * 2
  const data = await DataProcessor.processCSV(staticFile('go/go.csv'), config)
  //   await Assets.load('HarmonyOS_Sans_SC_Regular.ttf')

  await app.init({
    width: config.canvasWidth,
    height: config.canvasHeight,
    backgroundColor: config.backgroundColor,
    textureGCCheckCountMax: 99999999999999,
    roundPixels: true,
    antialias: true,
  })

  // eslint-disable-next-line no-console
  console.log('[ANI] initializing')
  document.getElementById('canvas-el')?.replaceWith(app.canvas)

  for (const key of imageMap.keys()) {
    const url = imageMap.get(key)!
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url
    await new Promise((resolve, reject) => {
    // timeout 10s
      setTimeout(() => {
        reject(new Error(`load image ${url} timeout`))
      }, 1000)
      image.onload = resolve
    })
    const minH = 50
    const h = Math.max(minH, image.height)
    image.width = image.width * h / image.height
    image.height = h
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    canvas.width = image.width
    canvas.height = image.height
    ctx.drawImage(image, 0, 0, image.width, image.height)
    const dataURL = canvas.toDataURL('image/webp')
    const texture = await Assets.load(dataURL)
    textureMap.set(key, texture)
  }

  const barChart = new BarChart(data, config)
  app.stage.addChild(barChart)

  const topInfo = new TopInfo(data, config)
  topInfo.x = 16
  topInfo.y = 16

  app.stage.addChild(topInfo)
  barChart.update(0)
  topInfo.update(0)
  return [barChart, topInfo]
}

class TopInfo extends Container {
  data: Data[][]
  config: Config
  topText: Text
  flag: Sprite
  country: Text
  photo: Sprite
  holderText: Text
  holdTimeText: BitmapText
  holdTime: number
  numberFormater: Intl.NumberFormat
  topRightText: Text
  dateLabel: BitmapText
  leftTextGroup: Container
  showDateLabel: boolean
  constructor(data: Data[][], config: Config) {
    super()
    this.data = data
    this.config = config
    this.photo = new Sprite()
    const lineHeight = 48
    const padding = 10
    this.photo.anchor.set(0, 0)

    this.topText = new Text({
      style: {
        fontSize: lineHeight,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })

    this.country = new Text({
      style: {
        fontSize: lineHeight,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })

    this.holderText = new Text({
      text: '#1 WHR 头衔持有者',
      style: {
        fontSize: lineHeight,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })
    this.holdTimeText = new BitmapText({
      text: '持有 0 天',
      style: {
        fontSize: lineHeight,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })
    this.topRightText = new Text({
      text: 'WHR 等级分最高的前 12 名选手',
      style: {
        fontSize: lineHeight,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })
    this.dateLabel = new BitmapText({
      style: {
        fontSize: 120,
        fontFamily: config.fontFamily,
        fill: 0xAAAAAA,
      },
    })
    this.flag = Sprite.from(textureMap.get('cn')!)
    this.flag.x = padding
    const flagAspect = this.flag.height / this.flag.width
    this.flag.height = 24
    this.flag.width = this.flag.height / flagAspect
    // y center
    this.country.x = this.flag.width + padding + padding

    this.flag.y = (this.country.height - this.flag.height) / 2

    this.showDateLabel = true
    this.topText.x = padding
    this.topText.y = lineHeight + padding
    this.holderText.x = padding
    this.holderText.y = lineHeight * 2 + padding * 2
    this.holdTimeText.x = padding
    this.holdTimeText.y = lineHeight * 3 + padding * 3
    this.topRightText.x = config.width
    this.topRightText.y = 0
    this.topRightText.anchor.set(1, 0)
    this.dateLabel.x = config.width
    this.dateLabel.y = lineHeight
    this.dateLabel.anchor.set(1, 0)
    this.leftTextGroup = new Container()
    this.leftTextGroup.addChild(this.topText, this.flag, this.country, this.holderText, this.holdTimeText)
    this.addChild(this.leftTextGroup)
    this.addChild(this.photo, this.dateLabel, this.topRightText)
    this.holdTime = 0
    this.numberFormater = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
  }

  update(i: number) {
    if (i >= this.data.length) {
      return
    }
    const data = this.data[i]
    const topData = data[0]
    const topIDList = this.data.map(d => d[0].id)

    const currentID = topData.id
    let j = i
    while (j >= 0 && topIDList[j] === currentID) {
	    j--
    }
    const prevStep = j < 0 ? this.data[0][0].step : this.data[j][0].step

    this.flag.texture = textureMap.get(topData.raw[this.config.imageField])!
    switch (topData.raw.country) {
      case 'cn':
        this.country.text = '中国'
        break
      case 'jp':
        this.country.text = '日本'
        break
      case 'kr':
        this.country.text = '韩国'
        break
    }
    if (this.topText.text !== topData.id) {
      this.holdTime = 0
    }
    this.topText.text = topData.id
    const currentStep = data[0].step
    const deltaStep = currentStep - prevStep
    // step 转化为时间，默认 1 step 为 1 毫秒
    // 毫秒转化为天数
    const deltaDay = deltaStep / 1000 / 60 / 60 / 24
    this.holdTimeText.text = `持有 ${this.numberFormater.format(deltaDay)} 天`
    this.dateLabel.text = this.config.getStepLabel(currentStep)
    this.photo.texture = textureMap.get(topData.id)!
    // texture 高度改成 300，宽度等比例缩放
    const aspect = this.photo.texture.height / this.photo.texture.width
    this.photo.height = 300
    this.photo.width = this.photo.height / aspect
    this.leftTextGroup.x = this.photo.width + 10
  }
}

export function GoComposition() {
  const bar = useRef<BarChart>()
  const topInfo = useRef<TopInfo>()
  const { width, height, fps, durationInFrames } = useVideoConfig()
  const [handle] = useState(() => delayRender())
  useEffect(() => {
    init({
	  fps,
	  width,
	  height,
	  durationInFrames,
    }).then((res) => {
      bar.current = res[0] as BarChart
      topInfo.current = res[1] as TopInfo
      continueRender(handle)
    })
  }, [])
  const frame = useCurrentFrame()
  useEffect(() => {
    if (bar.current && topInfo.current) {
      bar.current.update(frame)
      topInfo.current.update(frame)
    }
  }, [frame])
  return (
    <canvas id="canvas-el" />
  )
}
