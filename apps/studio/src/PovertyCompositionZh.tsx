import { BarChart, Config, DataProcessor, textureMap } from '@anichart/core'
import { Application, Text, Texture } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadCjkFonts } from './fonts'

// 各国极端贫困人口 bar chart race（中文）。横屏 16:9 + 竖屏 9:16（抖音）两版，结构对齐 EVCompositionZh。
// 数据 scripts/update-worldbank-data.py → wb-poverty.csv（World Bank PIP，$3/天 2021 PPP，1981–2025）。
// BGM=violin-ledger.wav：总长 = BGM；赛跑铺前 POVERTY_RACE_SEC 秒、之后越界冻结在终榜。
export const POVERTY_FPS = 60
export const POVERTY_BGM_SEC = 133.32 // violin-ledger.wav 实测时长
// 让「中国归零」(2019 ≈ 全程 86%) 落在 BGM ~105s 的小提琴高潮：race = 105 / 0.864 ≈ 121.6s。
// 之后 2025 收尾、约 11s 定格在终榜，压住小提琴余韵。
export const POVERTY_RACE_SEC = 121.6
export const POVERTY_DURATION_IN_FRAMES = Math.round(POVERTY_BGM_SEC * POVERTY_FPS)

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// 英文国名 → ISO 3166-1 alpha-2（取 public/flagpack 国旗）。覆盖 wb-poverty.csv 全部 55 国。
const countryCode = new Map<string, string>([
  ['Argentina', 'ar'],
  ['Australia', 'au'],
  ['Belgium', 'be'],
  ['Brazil', 'br'],
  ['Canada', 'ca'],
  ['China', 'cn'],
  ['Egypt', 'eg'],
  ['France', 'fr'],
  ['Germany', 'de'],
  ['India', 'in'],
  ['Indonesia', 'id'],
  ['Iran', 'ir'],
  ['Italy', 'it'],
  ['Japan', 'jp'],
  ['Mexico', 'mx'],
  ['Netherlands', 'nl'],
  ['Nigeria', 'ng'],
  ['Pakistan', 'pk'],
  ['Poland', 'pl'],
  ['Russia', 'ru'],
  ['Saudi Arabia', 'sa'],
  ['South Africa', 'za'],
  ['South Korea', 'kr'],
  ['Spain', 'es'],
  ['Sweden', 'se'],
  ['Switzerland', 'ch'],
  ['Thailand', 'th'],
  ['Türkiye', 'tr'],
  ['United Kingdom', 'gb'],
  ['United States', 'us'],
  ['Bangladesh', 'bd'],
  ['Philippines', 'ph'],
  ['Vietnam', 'vn'],
  ['Ethiopia', 'et'],
  ['DR Congo', 'cd'],
  ['Ukraine', 'ua'],
  ['Israel', 'il'],
  ['Tanzania', 'tz'],
  ['Mozambique', 'mz'],
  ['Uganda', 'ug'],
  ['Kenya', 'ke'],
  ['Madagascar', 'mg'],
  ['Niger', 'ne'],
  ['Zambia', 'zm'],
  ['Malawi', 'mw'],
  ['Angola', 'ao'],
  ['Ghana', 'gh'],
  ['Côte d\'Ivoire', 'ci'],
  ['Burkina Faso', 'bf'],
  ['Mali', 'ml'],
  ['South Sudan', 'ss'],
  ['Burundi', 'bi'],
  ['Nepal', 'np'],
  ['Myanmar', 'mm'],
  ['Yemen', 'ye'],
  ['Colombia', 'co'],
])

// 英文国名 → 中文名（左侧 label 显示；id 仍用英文做稳定键 / 国旗 / region 配色）。
const countryZh = new Map<string, string>([
  ['Argentina', '阿根廷'],
  ['Australia', '澳大利亚'],
  ['Belgium', '比利时'],
  ['Brazil', '巴西'],
  ['Canada', '加拿大'],
  ['China', '中国'],
  ['Egypt', '埃及'],
  ['France', '法国'],
  ['Germany', '德国'],
  ['India', '印度'],
  ['Indonesia', '印度尼西亚'],
  ['Iran', '伊朗'],
  ['Italy', '意大利'],
  ['Japan', '日本'],
  ['Mexico', '墨西哥'],
  ['Netherlands', '荷兰'],
  ['Nigeria', '尼日利亚'],
  ['Pakistan', '巴基斯坦'],
  ['Poland', '波兰'],
  ['Russia', '俄罗斯'],
  ['Saudi Arabia', '沙特阿拉伯'],
  ['South Africa', '南非'],
  ['South Korea', '韩国'],
  ['Spain', '西班牙'],
  ['Sweden', '瑞典'],
  ['Switzerland', '瑞士'],
  ['Thailand', '泰国'],
  ['Türkiye', '土耳其'],
  ['United Kingdom', '英国'],
  ['United States', '美国'],
  ['Bangladesh', '孟加拉国'],
  ['Philippines', '菲律宾'],
  ['Vietnam', '越南'],
  ['Ethiopia', '埃塞俄比亚'],
  ['DR Congo', '刚果（金）'],
  ['Ukraine', '乌克兰'],
  ['Israel', '以色列'],
  ['Tanzania', '坦桑尼亚'],
  ['Mozambique', '莫桑比克'],
  ['Uganda', '乌干达'],
  ['Kenya', '肯尼亚'],
  ['Madagascar', '马达加斯加'],
  ['Niger', '尼日尔'],
  ['Zambia', '赞比亚'],
  ['Malawi', '马拉维'],
  ['Angola', '安哥拉'],
  ['Ghana', '加纳'],
  ['Côte d\'Ivoire', '科特迪瓦'],
  ['Burkina Faso', '布基纳法索'],
  ['Mali', '马里'],
  ['South Sudan', '南苏丹'],
  ['Burundi', '布隆迪'],
  ['Nepal', '尼泊尔'],
  ['Myanmar', '缅甸'],
  ['Yemen', '也门'],
  ['Colombia', '哥伦比亚'],
])

// 大洲配色：与 EVCompositionZh 一致（深色背景、互不撞色、避开中红/美蓝）。EV 表无 Africa，
// 而贫困 race 近年以非洲为主，补一个金色，否则非洲国家全落到灰色 fallback。
const REGION_COLOR: Record<string, number> = {
  'Asia': 0x2E_A8_8A, // 玉青
  'Europe': 0x7A_6A_D8, // 靛紫
  'North America': 0xE0_7B_2E, // 橙
  'South America': 0x5C_B0_4C, // 雨林绿
  'Oceania': 0x30_B8_D8, // 海洋青
  'Africa': 0xF2_C0_37, // 金（贫困 race 新增）
}

// 中国红高亮（脱贫主线）；美国蓝沿用 EV；其余按大洲。
function regionColor(d: any): number {
  if (d.id === 'China') {
    return 0xDE_29_10 // 五星红旗红
  }
  if (d.id === 'United States') {
    return 0x3D_5A_C9 // 星条旗蓝（提亮）
  }
  return REGION_COLOR[String(d.raw?.region ?? '')] ?? 0x88_88_88
}

// 左侧 label = 中文国名。label 走 DataProcessor preprocess、拿到原始 CSV 行 → 读 d.country（非 d.id）。
function countryLabel(d: any): string {
  return countryZh.get(d.country) ?? String(d.country ?? '')
}

// 中文紧凑数字：亿 / 万（贫困是亿级，整数千分位太长、刻度会重叠）。中国 1981 ≈ 9.6 亿。
function compactZh(v: number): string {
  if (v >= 1e8) {
    return `${(v / 1e8).toFixed(1)}亿`
  }
  if (v >= 1e4) {
    return `${Math.round(v / 1e4)}万`
  }
  return numberFmt.format(v)
}

// 脱贫计数器：逐年全球总量（year → 全数据集合计）。在 init 拿到 CSV 后填充一次（横/竖两版共享）。
const totalsByYear = new Map<number, number>()
const COUNTER_GREEN = 0x5B_E5_9A // 较 1981 净脱贫（人数下降）
const COUNTER_RED = 0xF0_6B_5A // 较 1981 贫困增加（人数上升，1981–1993 期）

function buildAggregates(csvText: string): void {
  if (totalsByYear.size > 0) {
    return
  }
  const lines = csvText.trim().split('\n')
  for (let i = 1; i < lines.length; i += 1) { // 跳过表头 country,region,year,value
    const cols = lines[i].split(',')
    const year = Number(cols[2])
    const value = Number(cols[3])
    if (!Number.isFinite(year) || !Number.isFinite(value)) {
      continue
    }
    totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + value)
  }
}

// 连续年份（小数）下的全球总量：在相邻整年间线性插值，让计数器数字随帧平滑滚动而非按年硬跳。
function totalAtYear(yearFloat: number): number {
  const y0 = Math.floor(yearFloat)
  const v0 = totalsByYear.get(y0)
  const v1 = totalsByYear.get(y0 + 1)
  if (v0 === undefined) {
    return v1 ?? 0
  }
  if (v1 === undefined) {
    return v0
  }
  return v0 + (v1 - v0) * (yearFloat - y0)
}

// 脱贫计数器：用 BarChart 当前帧的连续年份（frameMaxSteps[idx]，与柱子同源）插值总量 → 较 1981 的净增减。
// 连续插值即动画：数字随帧平滑变化。前期（总量仍在涨）显示「贫困增加」(红)，之后转「累计脱贫」(绿)。
function syncCounter(barChart: any, frame: number): void {
  const counter: Text | undefined = barChart.povertyCounter
  if (!counter) {
    return
  }
  const steps: Array<number | undefined> = barChart.frameMaxSteps
  const idx = Math.max(0, Math.min(frame, steps.length - 1))
  const yearFloat = steps[idx]
  const base = totalsByYear.get(1981)
  if (yearFloat === undefined || base === undefined) {
    counter.text = ''
    return
  }
  const diff = base - totalAtYear(yearFloat) // >0：较 1981 净脱贫；<0：贫困增加
  if (diff >= 0) {
    counter.text = `较 1981 累计脱贫\n${(diff / 1e8).toFixed(2)} 亿人`
    counter.style.fill = COUNTER_GREEN
  }
  else {
    counter.text = `较 1981 贫困增加\n${(-diff / 1e8).toFixed(2)} 亿人`
    counter.style.fill = COUNTER_RED
  }
}

// 横屏 / 竖屏差异都收在这里（取值对齐 EVCompositionZh 的两版）：
// - 横屏（B站/YouTube）：左侧国名 + 柱尾数值都留，topN 15，刻度 8，日期常规。
// - 竖屏（抖音）：去柱尾数字腾窄屏空间，柱拉满 21，刻度 4，日期 ticker 放大当主视觉。
interface Variant {
  topN: number
  showLabel: boolean // 左侧中文国名
  showValue: boolean // 柱尾数值
  stepLabelFontSize: number // 右下角年份 ticker
  tickNum: number // x 轴刻度条数
  safe: { top: number, right: number, bottom: number, left: number } // 安全区内边距（竖屏避刘海/文案条/互动列）
}

function createConfig(v: Variant): Config {
  return new Config({
    // 身份用英文国名（稳定键）→ 同一国一条连续柱、供国旗 / region 配色；显示名走 countryZh。
    id: 'country',
    step: 'year',
    value: 'value',
    // 中国红 / 美国蓝主线，其余按大洲（含新增非洲金）。
    color: regionColor,
    // 左侧 label = 中文国名（读原始 country 列）；竖屏也保留。
    label: countryLabel,
    showLabel: v.showLabel,
    image: 'country',
    topN: v.topN,
    // 国名在左侧 label，柱上不重复（仅留国旗 banner）。
    getBarInfo: () => '',
    // 绝对人数，从 0 起更诚实；adaptive 在中国断层领先时会把下界压成负数。
    valueScale: { type: 'from-zero' },
    // 换位（纵向 rank 运动）整体放慢一点：默认 0.8s → 1.1s，交换更从容；lookahead 防逆序会按比例自动缩放。
    swap: { durationSec: 1.1 },
    style: { tickNum: v.tickNum },
    // 拉丁/数字走等宽 Berkeley Mono，汉字按字回退到 HarmonyOS Sans SC。
    fontFamily: 'Berkeley Mono, HarmonyOS Sans SC',
    // 三处文本分工：轴标题=度量+口径、标题=主题、副标题=范围+来源+预测说明。
    xAxisLabel: '极端贫困人口（$3/天 2021 PPP）',
    title: '各国极端贫困人口',
    subtitle: '1981–2025 · World Bank PIP（$3/天 2021 PPP）· 2023+ 为官方预测',
    // 年份 ticker 只显示纯年份；2023+ 为预测的口径说明留在副标题，ticker 上不重复。
    getStepLabel: step => String(Math.round(step)),
    totalDurationSec: POVERTY_RACE_SEC,
    // 竖屏关掉柱尾数字；显示时用紧凑「亿/万」（人数亿级，整数过长）。
    getValueLabel: d => v.showValue ? compactZh(d.value) : '',
    getTickLabel: val => compactZh(val),
  })
}

// 每个画幅一套独立 config + 组件。PIXI Application 每次挂载现 new、卸载即 destroy（对齐 EVCompositionZh）。
function makeComposition(variant: Variant) {
  const config = createConfig(variant)

  async function init(app: Application, { fps, width, height }: { fps: number, width: number, height: number }) {
    config.fps = fps
    config.canvasWidth = width
    config.canvasHeight = height
    // 安全区：chart 从 (x,y) 起、占 width×height，四边按 variant.safe 内缩（构造期按默认 1920×1080 算死，须在此重算）。
    const s = variant.safe
    config.x = s.left
    config.y = s.top
    config.width = width - s.left - s.right
    config.height = height - s.top - s.bottom
    config.totalDurationSec = POVERTY_RACE_SEC

    const fontReady = loadCjkFonts()
    const csvUrl = staticFile('wb-poverty.csv')
    const [data, csvText] = await Promise.all([
      DataProcessor.processCSV(csvUrl, config),
      fetch(csvUrl).then(r => r.text()),
    ])
    // 原始逐年值（趋势箭头 + 脱贫计数器用），按 csv 原始行聚合，绕开插值帧。
    buildAggregates(csvText)

    // 国旗：4:3 SVG 画进 canvas，keyed by 英文国名（=id/raw.country）；必须在建 BarChart 前加载完。
    const countries = [...new Set(data.flat().map(d => String(d.raw?.country ?? '')).filter(Boolean))]
    await Promise.all(countries.map(async (country) => {
      if (textureMap.has(country)) {
        return
      }
      const code = countryCode.get(country)
      if (!code) {
        return
      }
      try {
        const image = new Image()
        image.src = staticFile(`flagpack/flags/4x3/${code}.svg`)
        await image.decode()
        const h = 60
        const w = Math.round(h * 4 / 3)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        if (country === 'Nepal') {
          // 尼泊尔是全球唯一非矩形国旗（双三角）：flagpack 的 np.svg 把双三角塞进 21×15 画框，
          // 旗本体只占左侧 ~63%（path 右尖 x≈13.25），右侧透明。整框拉满会左挤+横向变形，
          // 故只取左侧三角区、按真实比例（13.25:15≈0.88）铺满高、水平居中，两侧留透明保形。
          const nw = image.naturalWidth || 21
          const nh = image.naturalHeight || 15
          const sw = nw * (13.25 / 21) // 源裁剪：仅双三角所在的左侧区域
          const dw = Math.round(h * (13.25 / 15)) // 目标宽：铺满高后按真实比例反推
          const dx = Math.round((w - dw) / 2) // 水平居中，两侧透明
          ctx.drawImage(image, 0, 0, sw, nh, dx, 0, dw, h)
        }
        else {
          ctx.drawImage(image, 0, 0, w, h)
        }
        textureMap.set(country, Texture.from(canvas))
      }
      catch {
        // 没有对应国旗的国家跳过
      }
    }))
    await fontReady

    await app.init({
      width: config.canvasWidth,
      height: config.canvasHeight,
      backgroundColor: config.backgroundColor,
      roundPixels: true,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    const barChart = new BarChart(data, config)
    // 年份 ticker 字号没有 Config 开关（core 硬编码 48），构造后直接改 stepLabel；anchor 右下，放大只往左上长。
    barChart.stepLabel.style.fontSize = variant.stepLabelFontSize
    // 脱贫计数器：贴在年份 ticker 正上方（共用 stepLabel 的右下锚点坐标系），文本/颜色每帧由 syncCounter 刷。
    const counter = new Text({
      text: '',
      style: {
        fontSize: Math.round(variant.stepLabelFontSize * 0.42),
        lineHeight: Math.round(variant.stepLabelFontSize * 0.52),
        fill: COUNTER_GREEN,
        fontFamily: config.fontFamily,
        align: 'right',
      },
    })
    counter.anchor.set(1, 1)
    counter.position.set(config.width, config.height - variant.stepLabelFontSize * 1.35)
    barChart.addChild(counter)
    ;(barChart as any).povertyCounter = counter
    app.stage.addChild(barChart)
    barChart.update(0)
    syncCounter(barChart, 0)
    return barChart
  }

  return function PovertyComposition() {
    const containerRef = useRef<HTMLDivElement>(null)
    const bar = useRef<BarChart>(undefined)
    const { width, height, fps } = useVideoConfig()
    const [handle] = useState(() => delayRender())
    const frame = useCurrentFrame()
    const frameRef = useRef(frame)
    frameRef.current = frame

    useEffect(() => {
      let cancelled = false
      const app = new Application()
      init(app, { fps, width, height }).then((res) => {
        if (cancelled) {
          return
        }
        bar.current = res
        res.update(frameRef.current)
        syncCounter(res, frameRef.current)
        containerRef.current?.append(app.canvas)
        continueRender(handle)
      })
      return () => {
        cancelled = true
        bar.current = undefined
        try {
          app.destroy(true, { children: true })
        }
        catch {
          // app 尚未 init 完成时 destroy 可能抛，忽略即可
        }
      }
    }, [])

    useEffect(() => {
      if (bar.current) {
        bar.current.update(frame)
        syncCounter(bar.current, frame)
      }
    }, [frame])

    return (
      <>
        {/* 仅 Studio 预览发声；成片由 render 脚本用 ffmpeg mux 上 BGM。 */}
        <Audio src={staticFile('violin-ledger.wav')} volume={0.85} />
        <div ref={containerRef} />
      </>
    )
  }
}

// 横屏 16:9（B 站 / YouTube）：左侧国名 + 柱尾数值都留，topN 15，刻度 8。
export const PovertyCompositionZh = makeComposition({
  topN: 15,
  showLabel: true,
  showValue: true,
  stepLabelFontSize: 96,
  tickNum: 8,
  safe: { top: 0, right: 10, bottom: 20, left: 10 },
})
// 竖屏 9:16（特供抖音）：保留左侧国名，去柱尾数字，条目拉满 21，刻度 4，年份放大到 96。
// 安全区（1080×1920）：顶 160 避刘海/状态栏；底 320 避抖音文案+用户名+音乐条；右 96 避互动按钮列；左 40 页边。
export const PovertyCompositionZhVertical = makeComposition({
  topN: 21,
  showLabel: true,
  showValue: false,
  stepLabelFontSize: 140,
  tickNum: 4,
  safe: { top: 160, right: 96, bottom: 320, left: 40 },
})
