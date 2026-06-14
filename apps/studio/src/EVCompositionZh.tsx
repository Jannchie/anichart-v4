import { BarChart, Config, DataProcessor, textureMap } from '@anichart/core'
import { Application, Texture } from 'pixi.js'
import { useEffect, useRef, useState } from 'react'
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadCjkFonts } from './fonts'

// 各国新能源车年销量 race（中文版，与 apps/playground/src/datasets.ts 的 'wb-ev-zh' 条目一致）。
// 数据 wb-ev.csv 来自 scripts/update-worldbank-data.py（OWID electric-car-sales / IEA 口径：
// 纯电 BEV + 插混 PHEV 乘用车，2010–2025）。中文用「新能源车」更贴口径（含插混）且不与电瓶车混淆。
// 身份 / 国旗 / 配色都用英文国名（country 列，稳定键）；显示名走 countryZh。
// 视频总长 = BGM 全长（Helios Grid Rising.wav 实测 139.44s）；BGM 整段一直播到底。
// 赛跑只占前 EV_RACE_SEC 秒，之后 BarChart.update 越界自动冻结在终榜——剩下的 ~14s 是片尾定格，
// 由 BGM 的舒缓尾声铺着（前期快、后期定格 = 把高潮卡在中国反超那一刻）。
// 中美交叉点（China==US）发生在 2014→2015 插值途中、约 2014.31 年 → 占总进度 ~0.2875；
// 要让交叉落在 ~36s，取 EV_RACE_SEC ≈ 36 / 0.2875 ≈ 125（125 × 0.2875 ≈ 35.9s）。
// 两个版本共用同一份数据 / 配色 / 时间轴，只有画幅与 topN 不同：横屏 16:9 发 B 站 / YouTube，
// 竖屏 9:16 特供抖音等手机端（柱更少、更粗，手机上读得清）。
export const EV_BGM_SEC = 139.44
export const EV_RACE_SEC = 125
export const EV_FPS = 60
export const EV_DURATION_IN_FRAMES = Math.round(EV_BGM_SEC * EV_FPS)

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// 英文国名 → ISO 3166-1 alpha-2（取 public/flagpack/flags/4x3/<code>.svg）。仅含 wb-ev.csv 出现的国家。
const countryCode = new Map<string, string>([
  ['Australia', 'au'],
  ['Belgium', 'be'],
  ['Brazil', 'br'],
  ['Canada', 'ca'],
  ['China', 'cn'],
  ['France', 'fr'],
  ['Germany', 'de'],
  ['India', 'in'],
  ['Israel', 'il'],
  ['Italy', 'it'],
  ['Japan', 'jp'],
  ['Mexico', 'mx'],
  ['Netherlands', 'nl'],
  ['Poland', 'pl'],
  ['South Korea', 'kr'],
  ['Spain', 'es'],
  ['Sweden', 'se'],
  ['Switzerland', 'ch'],
  ['Türkiye', 'tr'],
  ['United Kingdom', 'gb'],
  ['United States', 'us'],
])

// 英文国名 → 中文名（左侧 label 显示；id 仍用英文做稳定键 / 国旗 / 配色）。
const countryZh = new Map<string, string>([
  ['Australia', '澳大利亚'],
  ['Belgium', '比利时'],
  ['Brazil', '巴西'],
  ['Canada', '加拿大'],
  ['China', '中国'],
  ['France', '法国'],
  ['Germany', '德国'],
  ['India', '印度'],
  ['Israel', '以色列'],
  ['Italy', '意大利'],
  ['Japan', '日本'],
  ['Mexico', '墨西哥'],
  ['Netherlands', '荷兰'],
  ['Poland', '波兰'],
  ['South Korea', '韩国'],
  ['Spain', '西班牙'],
  ['Sweden', '瑞典'],
  ['Switzerland', '瑞士'],
  ['Türkiye', '土耳其'],
  ['United Kingdom', '英国'],
  ['United States', '美国'],
])

// 大洲配色：一套符合直觉、互不撞色、且都避开中红/美蓝的固定表（深色背景，取中高明度）。
// 南美=雨林绿、大洋洲=海洋青；亚洲玉青 / 欧洲靛紫 / 北美橙，与主角红蓝拉开。
const REGION_COLOR: Record<string, number> = {
  Asia: 0x2E_A8_8A, // 玉青
  Europe: 0x7A_6A_D8, // 靛紫
  'North America': 0xE0_7B_2E, // 橙
  'South America': 0x5C_B0_4C, // 雨林绿
  Oceania: 0x30_B8_D8, // 海洋青
}

// 中国红 / 美国蓝两条主线高亮（取国旗色）；其余国家按大洲走 REGION_COLOR。
function regionColor(d: any): number {
  if (d.id === 'China') {
    return 0xDE_29_10 // 五星红旗红 #DE2910
  }
  if (d.id === 'United States') {
    return 0x3D_5A_C9 // 星条旗蓝 Old Glory Blue（#3C3B6E）提亮，深底上更显
  }
  return REGION_COLOR[String(d.raw?.region ?? '')] ?? 0x88_88_88
}

// 左侧 label = 中文国名。注意：label 走 DataProcessor 的 preprocess、拿到的是**原始 CSV 行**
//（列只有 country/region/year/value，没有 id），所以这里读 d.country，不能读 d.id——
// 读 d.id 会得到 undefined，labelMap 为空 → maxLabelWidth=0 → 左侧不预留空间。
function countryLabel(d: any): string {
  return countryZh.get(d.country) ?? String(d.country ?? '')
}

// 中文紧凑数字：万 / 亿，竖屏顶部刻度用（整数加千分位太长、刻度间会重叠）。
// 最大约 1330 万（< 1 亿），所以基本都落在「万」档。
function compactZh(v: number): string {
  if (v >= 1e8) {
    return `${(v / 1e8).toFixed(1)}亿`
  }
  if (v >= 1e4) {
    return `${Math.round(v / 1e4)}万`
  }
  return numberFmt.format(v)
}

// 横屏 / 竖屏的差异都收在这里：
// - 横屏（B站/YouTube）：宽幅信息密度高 → 左侧国名 + 柱尾数值都留，topN 15，刻度多且整数全写，日期常规。
// - 竖屏（抖音）：手机端做减法 → 保留左侧国名、去掉柱尾数字（窄屏腾地方），柱更多更满，刻度更少 +
//   紧凑「万」格式（避免重叠），日期 ticker 放大当主视觉。
interface Variant {
  topN: number
  showLabel: boolean // 左侧中文国名
  showValue: boolean // 柱尾数值
  stepLabelFontSize: number // 右下角日期 ticker（构造后设到 barChart.stepLabel）
  tickNum: number // x 轴刻度条数
  compactTicks: boolean // 刻度用紧凑「万/亿」而非整数千分位
  // 安全区内边距（px，按各自画布尺寸）：竖屏避开顶部刘海/状态栏、底部抖音文案条、右侧互动按钮。
  safe: { top: number, right: number, bottom: number, left: number }
}

function createConfig(v: Variant): Config {
  return new Config({
    // 身份用英文国名（稳定键）→ 同一国一条连续柱、供国旗 / region 配色；显示名走 countryZh。
    id: 'country',
    step: 'year',
    value: 'value',
    // 主角配色：中国红、美国蓝（本片的两条主线），其余国家按大洲 region。
    color: regionColor,
    // 左侧 label = 中文国名（见 countryLabel 注释：读原始 country 列）；竖屏关掉。
    label: countryLabel,
    showLabel: v.showLabel,
    image: 'country',
    topN: v.topN,
    // 国名在左侧 label，柱上不重复（仅留国旗 banner）。
    getBarInfo: () => '',
    // 绝对销量，从 0 起更诚实；adaptive 在中国断层领先时会把下界压成负数。
    valueScale: { type: 'from-zero' },
    // 刻度条数：竖屏窄、调少避免标签重叠。
    style: { tickNum: v.tickNum },
    // 拉丁/数字走等宽 Berkeley Mono，汉字按字回退到 HarmonyOS Sans SC。
    fontFamily: 'Berkeley Mono, HarmonyOS Sans SC',
    // 三处文本分工、互不重复：轴标题=度量单位、标题=主题、副标题=范围+来源。
    xAxisLabel: '新能源车年销量（辆）',
    title: '各国新能源车销量',
    subtitle: '全球新能源车竞赛 2010–2025 · 数据来源 IEA / OWID',
    getStepLabel: step => String(Math.round(step)),
    totalDurationSec: 120,
    // 竖屏关掉柱尾数字：getValueLabel 返回空串。
    getValueLabel: d => v.showValue ? numberFmt.format(d.value) : '',
    // 刻度：竖屏紧凑「万/亿」，横屏整数千分位。
    getTickLabel: val => v.compactTicks ? compactZh(val) : numberFmt.format(val),
  })
}

// 每个画幅一套独立 config。PIXI Application 不在这里建——每次挂载现 new 一个、卸载即 destroy，
// 既避开「两版共用一块 canvas」也避开「app.init 重复调用」（Studio 切换 composition 会卸载重挂）。
function makeComposition(variant: Variant) {
  const config = createConfig(variant)

  async function init(app: Application, { fps, width, height }: { fps: number, width: number, height: number }) {
    config.fps = fps
    config.canvasWidth = width
    config.canvasHeight = height
    // 安全区：chart 从 (x,y) 起、占 width×height，四边按 variant.safe 内缩。
    // 关键：width/height 构造期按「默认」1920×1080 算死、改 canvasWidth/Height 不联动，必须在此重算，
    // 否则竖屏按 1900 宽布局画到 1080 画布上会溢出。横屏 safe={0,10,20,10} → 仍是 (10,0) 1900×1060
    //（与改前像素一致）；竖屏留出顶部刘海/状态栏、底部抖音文案条、左右页边。
    const s = variant.safe
    config.x = s.left
    config.y = s.top
    config.width = width - s.left - s.right
    config.height = height - s.top - s.bottom
    // 赛跑只占前 EV_RACE_SEC 秒（速度不变，前期不会被压快）；之后的帧由 BarChart.update 越界自动冻结
    // 在终榜（片尾定格）。注意：不要用 durationInFrames 推 totalDurationSec，否则定格帧会反过来拖慢赛跑。
    config.totalDurationSec = EV_RACE_SEC
    // 中文版需 Berkeley Mono + HarmonyOS 两套；构建 BarChart（创建 PIXI Text，含汉字测量）前必须 await。
    const fontReady = loadCjkFonts()
    const data = await DataProcessor.processCSV(staticFile('wb-ev.csv'), config)

    // 国旗：4:3 SVG 画进 canvas（bar 按柱高缩放并保留宽高比），keyed by 英文国名（=id/raw.country）。
    // 必须在构建 BarChart 前加载完。textureMap 是全局、两版共用（幂等）；没对应码 / 失败的国家跳过。
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
        canvas.getContext('2d')!.drawImage(image, 0, 0, w, h)
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
      // 见 AAComposition：按 devicePixelRatio 提分辨率，配合 --scale 渲染真 4K。
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    const barChart = new BarChart(data, config)
    // 日期 ticker 字号没有 Config 开关（core 里硬编码 48），构造后直接改公开的 stepLabel——
    // anchor 在右下，放大只往左上长、不跑位。走属性而非改 core，免去 core 重建。
    barChart.stepLabel.style.fontSize = variant.stepLabelFontSize
    app.stage.addChild(barChart)
    barChart.update(0)
    return barChart
  }

  return function EVComposition() {
    // React 只拥有这个容器 div；PIXI canvas 由我们 appendChild 进去（React 不追踪它）。
    // 切勿用 replaceWith 顶掉 React 节点——卸载时 React 会 removeChild 一个已不在 DOM 的节点而抛
    // NotFoundError。容器方案下卸载只删 React 自己的 div，canvas 随 app.destroy 一起走。
    const containerRef = useRef<HTMLDivElement>(null)
    const bar = useRef<BarChart>(undefined)
    const { width, height, fps } = useVideoConfig()
    const [handle] = useState(() => delayRender())
    const frame = useCurrentFrame()
    // 渲染时每个并发 chunk 的首帧都以「挂载帧」重新 mount；init 收尾的 update(0) 会让这些帧闪回起始态。
    // 用 ref 记住当前帧，init 完成时同步渲到该帧（而非 0），消除 chunk 首帧闪烁。
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
        containerRef.current?.append(app.canvas)
        continueRender(handle)
      })
      return () => {
        cancelled = true
        bar.current = undefined
        // removeView=true 删掉 canvas；options 只销毁 stage 子节点，不碰 texture（国旗纹理全局共用）。
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
      }
    }, [frame])

    return (
      <>
        {/* 见 AAComposition：仅供 Studio 预览发声；成片 BGM 由 render 脚本用 ffmpeg mux 上去。 */}
        <Audio src={staticFile('helios-grid-rising.wav')} volume={0.7} />
        <div ref={containerRef} />
      </>
    )
  }
}

// 横屏 16:9（B 站 / YouTube）：满屏铺开，安全区仅留与改前一致的页边（(10,0) 1900×1060）。
export const EVCompositionZh = makeComposition({
  topN: 15, showLabel: true, showValue: true, stepLabelFontSize: 48, tickNum: 8, compactTicks: false,
  safe: { top: 0, right: 10, bottom: 20, left: 10 },
})
// 竖屏 9:16（特供抖音）：保留左侧国名，去柱尾数字，条目拉满 21 国，刻度 4 条 + 紧凑「万」，日期放大到 96。
// 安全区（1080×1920）：顶 160 避刘海/状态栏；底 320 避抖音文案+用户名+音乐条；右 96 避互动按钮列；左 40 页边。
export const EVCompositionZhVertical = makeComposition({
  topN: 21, showLabel: true, showValue: false, stepLabelFontSize: 96, tickNum: 4, compactTicks: true,
  safe: { top: 160, right: 96, bottom: 320, left: 40 },
})
