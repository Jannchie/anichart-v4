import { colors, Config, textureMap } from '@anichart/core'
import dayjs from 'dayjs'
import { Texture } from 'pixi.js'

// playground 可切换的数据集注册表。每个条目给出 CSV 路径与一个 Config 工厂
// （字段映射 + 配色 + 文案格式化）。切换数据集时重新 makeConfig() 并加载对应 CSV，
// loadAssets 在建图前把数据集需要的纹理（公司 logo 等）灌进 core 的 textureMap。

export interface DatasetDef {
  key: string
  label: string
  file: string
  makeConfig: () => Config
  loadAssets?: (rows: Array<Record<string, string | undefined>>) => Promise<void>
  // 柱状图是否显示左侧分类 label（main.ts 据此覆盖默认「柱状图不显示 label」）。
  showBarLabel?: boolean
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// 中文数字用「万 / 亿 / 万亿」（Intl zh-CN 紧凑记数），比 K/M 更符合中文习惯。固定 2 位小数（不忽 1
// 忽 2 位），0 特判免得显示「0.00」。仅用于国家级量级（人口 / GDP / 军费）；离散计数（投稿数 / 在线
// 人数 / 电动车）用整数全数字，见各 config。实例复用，避免每帧重建。
const zhCompactFmt = new Intl.NumberFormat('zh-CN', { notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const zhCompactUSDFmt = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const zhCompact = (v: number) => v === 0 ? '0' : zhCompactFmt.format(v)
const zhCompactUSD = (v: number) => v === 0 ? '$0' : zhCompactUSDFmt.format(v)

// ───────────────────────── LLM Chatbot Arena ─────────────────────────
// 与 apps/studio/src/baseComposition.tsx 保持一致：同一份 llm.csv、同样以「公司」为
// id、同一张公司配色表、同样的 bar 信息（model - company）与坐标轴文案。
// 公司名与 scripts/update-llm-data.py 的展示名一致，同时是 public/logos/ 下的文件名。
const llmColorMap = new Map<string, number>([
  ['OpenAI', 0x74_A8_9B],
  ['Google', 0xFE_51_4D],
  ['Anthropic', 0xD2_75_56],
  ['Meta', 0x00_5F_D5],
  ['Microsoft', 0x00_A1_F1],
  ['Alibaba', 0xFF_6C_00],
  ['Mistral AI', 0xFF_70_00],
  ['Amazon', 0xFF_99_00],
  ['Databricks', 0xFF_8A_80],
  ['DeepSeek', 0x41_69_E1],
  ['Tencent', 0x16_8E_FF],
  ['MiniMax', 0xB1_65_FF],
  ['01.AI', 0x1F_A8_7A],
  ['AI2', 0x6E_B5_3C],
  ['NVIDIA', 0x76_B9_00],
  ['IBM', 0x24_75_B2],
  ['TII', 0x77_44_FF],
  ['Perplexity AI', 0xAD_2E_FF],
  ['Cohere', 0xFF_D6_00],
  ['Snowflake', 0x56_B9_FF],
  ['Upstage', 0xD7_3B_E2],
  ['Hugging Face', 0xFF_D2_1F],
  ['Nous Research', 0x11_AA_99],
  ['LMSYS', 0x7A_00_D6],
  ['Stanford', 0xB1_04_0E],
  ['UC Berkeley', 0x1E_68_2E],
  ['Nexusflow', 0xB2_15_56],
  ['InternLM', 0x1C_9C_B8],
  ['RWKV', 0x9B_4F_C7],
  ['OpenAssistant', 0xA3_C6_44],
  ['Reka AI', 0x78_3E_96],
  ['StepFun', 0xFF_4F_81],
  ['Nomic AI', 0x4F_8A_C7],
  ['Cognitive Computations', 0xA9_96_7B],
  ['AI21 Labs', 0xD9_27_67],
  ['OpenChat', 0xA6_B1_15],
  ['Stability AI', 0x6B_4F_7F],
  ['xAI', 0x8A_8A_93],
  ['Z.ai', 0x49_7A_9A],
  ['Moonshot AI', 0x32_63_DD],
  ['Baidu', 0x29_32_E1],
  ['ByteDance', 0x32_5A_B4],
  ['Xiaomi', 0xFF_C2_99],
  ['Meituan', 0xFF_D1_00],
  ['Ant Group', 0x16_77_FF],
  ['Inception AI', 0x7C_3A_ED],
  ['Prime Intellect', 0x00_B2_A9],
  ['Together AI', 0x0F_6F_FF],
  ['Arcee AI', 0xD2_3F_57],
  ['MosaicML', 0xE0_38_3D],
  ['Tsinghua', 0xB3_0E_8E],
  ['Princeton', 0xF5_80_25],
  // webdev / vision / search / 文生图 品类新增公司
  ['Kuaishou', 0xFF_5E_00],
  ['Black Forest Labs', 0xF5_A6_23],
  ['Ideogram', 0x21_9E_BC],
  ['Recraft', 0xE0_5E_6B],
  ['Runway', 0x00_C8_96],
  ['Luma AI', 0x7C_5C_FF],
  ['Reve', 0xD9_4F_8C],
  ['Krea', 0x4C_AF_E8],
  ['HiDream', 0x36_B3_7E],
  ['Leonardo AI', 0xB0_5C_E8],
  ['Diffbot', 0x5C_8A_E8],
])

// 公司 logo（scripts/update-llm-data.py --logos 下载到 public/logos/）。
// 加载失败的公司直接没有 logo，bar 渲染会自动跳过。
// logo 会被 bar 按整高渲染：透明底的单色 glyph（lobehub 图标）贴边太挤，加一圈
// 透明边距；不透明的方形头像（GitHub 组织头像等）本身就是满幅设计，保持贴边。
const LOGO_PADDING_RATIO = 0.14

function logoTextureFrom(image: HTMLImageElement): Texture {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  canvas.width = image.width
  canvas.height = image.height
  ctx.drawImage(image, 0, 0)
  // 四角任一像素透明 → 视为 glyph 图标，需要边距
  const { width: w, height: h } = canvas
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
  const isGlyph = corners.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 255)
  if (!isGlyph) {
    return Texture.from(canvas)
  }
  const pad = Math.round(Math.max(w, h) * LOGO_PADDING_RATIO)
  const padded = document.createElement('canvas')
  padded.width = w + pad * 2
  padded.height = h + pad * 2
  padded.getContext('2d')!.drawImage(image, pad, pad)
  return Texture.from(padded)
}

async function loadCompanyLogos(rows: Array<Record<string, string | undefined>>): Promise<void> {
  const companies = [...new Set(rows.map(r => r.company).filter(c => c !== undefined && c !== ''))] as string[]
  await Promise.all(companies.map(async (company) => {
    if (textureMap.has(company)) {
      return
    }
    try {
      const image = new Image()
      image.src = `/logos/${encodeURIComponent(company)}.png`
      await image.decode()
      textureMap.set(company, logoTextureFrom(image))
    }
    catch {
      // 没有 logo 的公司（学术机构等）跳过
    }
  }))
}

function llmColor(id: string): number | undefined {
  if (llmColorMap.has(id)) {
    return llmColorMap.get(id)
  }
  const colorStr = colors(id)
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x00_00_00
}

// ───────────────────────── GDP 数值格式化 ─────────────────────────
function formatUSD(v: number): string {
  if (v >= 1e12) {
    return `$${(v / 1e12).toFixed(2)}T`
  }
  if (v >= 1e9) {
    return `$${(v / 1e9).toFixed(1)}B`
  }
  if (v >= 1e6) {
    return `$${(v / 1e6).toFixed(0)}M`
  }
  return `$${numberFmt.format(v)}`
}

// ───────────────────────── 各国 GDP：国旗 + 中文名 ─────────────────────────
// 英文国名（gdp.csv 的 country 列）→ ISO 3166-1 alpha-2，取 public/flagpack/flags/4x3/<code>.svg。
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
  // wb-* 数据集（人口 / CO₂ / 军费）新增的人口/军费大国
  ['Bangladesh', 'bd'],
  ['Philippines', 'ph'],
  ['Vietnam', 'vn'],
  ['Ethiopia', 'et'],
  ['DR Congo', 'cd'],
  ['Ukraine', 'ua'],
  ['Israel', 'il'],
  // wb-poverty 贫困 race 新增的极端贫困人口大国（多为撒哈拉以南非洲）
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
  ["Côte d'Ivoire", 'ci'],
  ['Burkina Faso', 'bf'],
  ['Mali', 'ml'],
  ['South Sudan', 'ss'],
  ['Burundi', 'bi'],
  ['Nepal', 'np'],
  ['Myanmar', 'mm'],
  ['Yemen', 'ye'],
  ['Colombia', 'co'],
])

// 英文国名 → 中文名（中文版 GDP 用 getBarInfo 显示；id 仍用英文做稳定键 / 国旗 / 配色）。
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
  ["Côte d'Ivoire", '科特迪瓦'],
  ['Burkina Faso', '布基纳法索'],
  ['Mali', '马里'],
  ['South Sudan', '南苏丹'],
  ['Burundi', '布隆迪'],
  ['Nepal', '尼泊尔'],
  ['Myanmar', '缅甸'],
  ['Yemen', '也门'],
  ['Colombia', '哥伦比亚'],
])

// 国旗：4:3 SVG 画进 canvas（bar 按柱高缩放并保留宽高比），keyed by 英文国名（=id/raw.country），
// 中英两版共用。没有对应码 / 加载失败的国家跳过（无国旗，bar 照常渲染）。
async function loadCountryFlags(rows: Array<Record<string, string | undefined>>): Promise<void> {
  const countries = [...new Set(rows.map(r => r.country).filter((c): c is string => !!c))]
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
      image.src = `/flagpack/flags/4x3/${code}.svg`
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
}

// 中英共用一份 gdp.csv：id 用英文国名（稳定键，供国旗 / region 配色）。国名 + 国旗都放柱上
// （getBarInfo + image），中文版 getBarInfo 走中文映射。
function makeGdpConfig(zh: boolean): Config {
  return new Config({
    id: 'country',
    step: 'year',
    value: 'gdp',
    color: 'region',
    label: '-',
    image: 'country',
    topN: 15,
    // GDP 是绝对量，从 0 起更诚实；adaptive 在 US 极度领先时会把下界压成负数。
    valueScale: { type: 'from-zero' },
    xAxisLabel: zh ? 'GDP（现价美元）' : 'GDP (current US$)',
    title: '各国 GDP',
    getStepLabel: step => String(Math.round(step)),
    getBarInfo: zh ? (d: any) => countryZh.get(d.id) ?? d.id : undefined,
    getValueLabel: d => zh ? zhCompactUSD(d.value) : formatUSD(d.value),
    getTickLabel: v => zh ? zhCompactUSD(v) : formatUSD(v),
  })
}

// ───────────────────────── 各国 人口 / CO₂ / 军费（World Bank）─────────────────────────
// 与 GDP 同一套国旗 + region 配色 + 中文名，仅指标 / 数值格式不同。数据来自 scripts/update-worldbank-data.py。
function formatPop(v: number): string {
  if (v >= 1e9) {
    return `${(v / 1e9).toFixed(2)}B`
  }
  if (v >= 1e6) {
    return `${(v / 1e6).toFixed(0)}M`
  }
  return numberFmt.format(v)
}

function formatCO2(v: number): string { // 原始单位 Mt
  return v >= 1000 ? `${(v / 1000).toFixed(2)} Gt` : `${Math.round(v)} Mt`
}

function formatTWh(v: number): string {
  return `${numberFmt.format(Math.round(v))} TWh`
}

// 大洲配色：与 studio EVCompositionZh.tsx 一致（深色背景、互不撞色、避开中红/美蓝）。
// 比 color:'region' 的 d3 ordinal 稳定——后者按首次出现顺序分配、切数据集会漂移。
const REGION_COLOR: Record<string, number> = {
  Asia: 0x2E_A8_8A, // 玉青
  Europe: 0x7A_6A_D8, // 靛紫
  'North America': 0xE0_7B_2E, // 橙
  'South America': 0x5C_B0_4C, // 雨林绿
  Oceania: 0x30_B8_D8, // 海洋青
  Africa: 0xF2_C0_37, // 金（EV 表无此项，为非洲主导的贫困 race 新增）
}

// 中国红 / 美国蓝两条主线高亮（取国旗色）；其余国家按大洲走 REGION_COLOR。
function regionColor(d: any): number {
  if (d.id === 'China') {
    return 0xDE_29_10 // 五星红旗红
  }
  if (d.id === 'United States') {
    return 0x3D_5A_C9 // 星条旗蓝（提亮）
  }
  return REGION_COLOR[String(d.raw?.region ?? '')] ?? 0x88_88_88
}

// fmt(v, zh)：中文走万/亿（Intl），英文沿用 B/M/T；CO₂(Gt/Mt) 与 TWh 是科学单位，两语言一致。
// projectedFrom：该年起的值含官方预测（仅贫困用），step label 标「含预测」。
// subtitle：副标题（范围 + 来源），EV 风格。leftLabel：国名放左侧 label、柱上只挂国旗（EV 风格）。
interface WbMetric {
  titleZh: string, titleEn: string, xZh: string, xEn: string
  fmt: (v: number, zh: boolean) => string
  projectedFrom?: number
  subtitleZh?: string, subtitleEn?: string
  leftLabel?: boolean
}
const WB_METRICS: Record<string, WbMetric> = {
  population: { titleZh: '各国人口', titleEn: 'Population by Country', xZh: '人口', xEn: 'Population', fmt: (v, zh) => zh ? zhCompact(v) : formatPop(v) },
  co2: { titleZh: '各国 CO₂ 排放', titleEn: 'CO₂ Emissions by Country', xZh: 'CO₂ 排放（百万吨）', xEn: 'CO₂ Emissions (Mt)', fmt: v => formatCO2(v) },
  military: { titleZh: '各国军费', titleEn: 'Military Spending by Country', xZh: '军费（美元）', xEn: 'Military Spending (US$)', fmt: (v, zh) => zh ? zhCompactUSD(v) : formatUSD(v) },
  // 环保 / 能源（OWID）—— 中国均断层第一
  electricity: { titleZh: '各国发电量', titleEn: 'Electricity Generation by Country', xZh: '发电量（TWh）', xEn: 'Electricity Generation (TWh)', fmt: v => formatTWh(v) },
  solar: { titleZh: '各国太阳能发电', titleEn: 'Solar Generation by Country', xZh: '太阳能发电（TWh）', xEn: 'Solar Generation (TWh)', fmt: v => formatTWh(v) },
  wind: { titleZh: '各国风能发电', titleEn: 'Wind Generation by Country', xZh: '风能发电（TWh）', xEn: 'Wind Generation (TWh)', fmt: v => formatTWh(v) },
  ev: { titleZh: '各国新能源车销量', titleEn: 'Electric Car Sales by Country', xZh: '新能源车年销量', xEn: 'Electric Car Sales (per year)', fmt: v => numberFmt.format(v) },
  // 各国极端贫困人口（World Bank PIP，$3/天 2021 PPP）。中国 1981≈9.6 亿 → 2019 起 0；2023+ 含官方预测。
  poverty: {
    titleZh: '各国极端贫困人口', titleEn: 'Extreme Poverty by Country',
    xZh: '极端贫困人口（$3/天 2021 PPP）', xEn: 'People in Extreme Poverty ($3/day, 2021 PPP)',
    fmt: (v, zh) => zh ? zhCompact(v) : formatPop(v),
    projectedFrom: 2023,
    subtitleZh: '全球极端贫困 1981–2025 · World Bank PIP（$3/天 2021 PPP）· 2023+ 为预测',
    subtitleEn: 'Extreme poverty 1981–2025 · World Bank PIP ($3/day, 2021 PPP) · 2023+ projected',
    leftLabel: true,
  },
}

function makeWbConfig(metric: keyof typeof WB_METRICS, zh: boolean): Config {
  const m = WB_METRICS[metric]
  return new Config({
    id: 'country',
    step: 'year',
    value: 'value',
    color: regionColor,
    // EV 风格(leftLabel)：国名放左侧 label、柱上只留国旗；否则国名挂柱上(getBarInfo)、不显左 label。
    label: m.leftLabel
      ? (zh ? (d: any) => countryZh.get(d.country) ?? String(d.country ?? '') : (d: any) => String(d.country ?? ''))
      : '-',
    image: 'country',
    topN: 15,
    valueScale: { type: 'from-zero' },
    xAxisLabel: zh ? m.xZh : m.xEn,
    title: zh ? m.titleZh : m.titleEn,
    subtitle: zh ? m.subtitleZh : m.subtitleEn,
    getStepLabel: (step) => {
      const y = Math.round(step)
      return m.projectedFrom && y >= m.projectedFrom ? `${y}（含预测）` : String(y)
    },
    getBarInfo: m.leftLabel ? () => '' : (zh ? (d: any) => countryZh.get(d.id) ?? d.id : undefined),
    getValueLabel: d => m.fmt(d.value, zh),
    getTickLabel: v => m.fmt(v, zh),
  })
}

// ───────────────────────── Steam 同时在线：游戏主题色 ─────────────────────────
// key = appid（CSV 的 appid 列，中英共用，配色稳定）。取各游戏招牌色。未列入回退调色板。
const steamColorMap = new Map<number, number>([
  [570, 0xC2_3C_2A], // Dota 2 红
  [730, 0xDE_9B_35], // CS2 金橙
  [578_080, 0xF2_A9_00], // PUBG 橙
  [1_172_470, 0xDA_29_2B], // Apex 红
  [271_590, 0x6B_9F_3F], // GTA5 钞票绿
  [252_490, 0xCD_41_2B], // Rust 锈红
  [440, 0xB8_38_3B], // TF2 红队
  [1_091_500, 0xF2_E2_05], // 赛博朋克 黄
  [1_245_620, 0xC8_A9_4B], // 艾尔登 金
  [1_086_940, 0x8B_2E_2E], // 博德之门3 暗红
  [1_623_730, 0x3F_B7_A0], // 帕鲁 青
  [2_358_720, 0xB5_85_2E], // 黑神话 暗金
  [553_850, 0xF5_D0_00], // 绝地潜兵2 超级地球黄
  [1_599_340, 0xC9_A2_4B], // 失落方舟 金
  [1_085_660, 0x5B_7F_B0], // 命运2 蓝
  [230_410, 0x3A_9F_B0], // 星际战甲 青
  [105_600, 0x6F_B5_4C], // 泰拉瑞亚 绿
  [413_150, 0x8F_B5_4A], // 星露谷 草绿
  [945_360, 0xC5_11_11], // 太空狼人杀 红
  [346_110, 0xE0_7B_2C], // 方舟 橙
  [582_010, 0x2E_6F_B0], // 怪猎世界 蓝
  [1_203_220, 0x3F_A9_8A], // 永劫无间 玉
  [289_070, 0x3E_6C_A3], // 文明6 蓝
  [1_326_470, 0x5E_8B_4E], // 森林之子 绿
  [381_210, 0xA0_18_18], // 黎明杀机 暗红
  [1_568_590, 0xF2_C8_4B], // 鹅鸭杀 黄
  [10, 0x9C_7A_30], // CS1.6 暗金
  [236_390, 0x7A_7A_3A], // 战争雷霆 橄榄
  [1_938_090, 0x6E_7B_3D], // 使命召唤 军绿
  [2_357_570, 0xF0_64_14], // 守望2 橙
  [240, 0x6B_7A_8F], // CS:起源 钢蓝
  [550, 0x9E_3B_2E], // 求生之路2 锈红
  [4000, 0x3A_7C_A5], // Garry's Mod 蓝
  [8930, 0xC9_A2_27], // 文明5 金
  [39_210, 0x3B_5B_A5], // FF14 水晶蓝
  [48_700, 0x8A_6D_3B], // 战团 中世纪棕
  [49_520, 0xE8_A3_17], // 无主之地2 橙黄
  [72_850, 0x5E_6B_73], // 天际 龙石灰蓝
  [107_410, 0x6B_72_33], // 武装突袭3 军绿
  [108_600, 0x7A_8C_3A], // 僵尸毁灭工程 橄榄
  [203_770, 0x8C_6B_2F], // 十字军之王2 王金
  [211_820, 0x2F_A4_A0], // 星界边境 太空青
  [214_950, 0xB2_3A_2A], // 罗马2 罗马红
  [218_620, 0x2E_9E_4F], // 收获日2 钞票绿
  [221_100, 0x8A_7A_4A], // DayZ 卡其
  [227_300, 0x2E_6D_B4], // 欧卡2 公路蓝
  [236_850, 0x3C_7A_6E], // 欧陆风云4 地图青
  [238_960, 0x8C_2E_22], // 流放之路 血红
  [250_900, 0x6B_4A_2A], // 以撒 阴沉棕
  [251_570, 0x8A_5A_2B], // 七日杀 锈橙
  [252_950, 0x2E_7C_E6], // 火箭联盟 电蓝
  [255_710, 0x4C_A6_4C], // 城市天际线 城市绿
  [261_550, 0x8C_3A_2E], // 霸主 绯红
  [268_500, 0x2E_8C_6A], // 幽浮2 青绿
  [275_850, 0xE0_61_2C], // 无人深空 宇宙橙
  [284_160, 0x5B_7A_99], // BeamNG 金属蓝灰
  [292_030, 0xA8_23_1F], // 巫师3 猎魔红
  [294_100, 0xB5_8A_4A], // 边缘世界 土黄
  [304_930, 0x6F_A8_4C], // Unturned 方块绿
  [322_170, 0x2E_C4_B6], // 几何冲刺 青
  [322_330, 0x6B_5B_45], // 饥荒 阴郁棕
  [359_320, 0xF0_7B_05], // 精英危险 橙
  [359_550, 0xD9_77_2E], // 彩虹六号 橙
  [364_360, 0xA8_3A_2A], // 战锤全战 红金
  [365_590, 0xE8_73_1F], // 全境封锁 SHD橙
  [374_320, 0xB5_53_2A], // 黑魂3 余烬橙
  [377_160, 0x3F_A3_4D], // 辐射4 Pip绿
  [386_360, 0xC9_A2_4B], // 神之浩劫 神金
  [394_360, 0x8C_7A_4A], // 钢铁雄心4 战图褐
  [427_520, 0xD9_83_24], // 异星工厂 工业橙
  [433_850, 0xC2_3B_2A], // H1Z1 大逃杀红
  [438_100, 0x2E_A7_C4], // VRChat 蓝
  [440_900, 0xB5_61_2E], // 流放者柯南 沙红
  [444_090, 0x2E_9E_8F], // 圣金枪手 青金
  [457_140, 0x2E_9E_A8], // 缺氧 青
  [489_830, 0x72_85_96], // 天际特别版 钢蓝
  [526_870, 0xF2_92_2A], // 幸福工厂 FICSIT橙
  [548_430, 0xE0_A9_2E], // 深岩银河 金
  [582_660, 0x9A_2E_3A], // 黑色沙漠 绯暗红
  [594_650, 0x8A_5A_3A], // 猎杀对决 血棕
  [739_630, 0x3E_8C_9E], // 恐鬼症 冷青
  [813_780, 0x2E_5C_9E], // 帝国时代2 皇蓝
  [892_970, 0x4A_6E_7A], // 英灵神殿 维京蓝灰
  [990_080, 0xB5_89_2E], // 霍格沃茨 格兰芬多金
  [1_063_730, 0x2E_8C_6E], // 新世界 永恒之地青
  [1_097_150, 0xE8_5A_A0], // 糖豆人 粉
  [1_142_710, 0x9A_2A_22], // 战锤3 库恩红
  [1_145_360, 0xC9_40_2E], // 哈迪斯 冥红
  [1_158_310, 0x9E_7A_38], // 十字军之王3 王金
  [1_172_620, 0x2E_9E_9A], // 盗贼之海 海盗青
  [1_174_180, 0xB2_3A_2A], // 大镖客2 红
  [1_203_620, 0x4A_8C_8A], // 笼罩 雾青
  [1_222_670, 0x3F_B2_3F], // 模拟人生4 绿钻
  [1_363_080, 0x7A_6B_3A], // 庄园领主 中世纪褐
  [1_364_780, 0xE0_55_2E], // 街霸6 橙红
  [1_426_210, 0xE0_70_3A], // 双人成行 暖橙
  [1_446_780, 0x3E_9E_7A], // 怪猎崛起 翠
  [1_449_850, 0x7A_3E_9E], // 游戏王 紫金
  [1_517_290, 0x3A_6E_A8], // 战地2042 蓝
  [1_551_360, 0x2E_9E_E0], // 地平线5 亮蓝
  [1_665_460, 0x2E_5C_B8], // eFootball 蓝
  [1_794_680, 0x8C_3E_9E], // 吸血鬼幸存者 紫
  [1_808_500, 0xC9_7A_2E], // ARC Raiders 橙
  [1_943_950, 0xC9_B8_4A], // 逃离后室 后室黄
  [1_962_700, 0x2E_9E_C4], // 深海迷航2 海蓝
  [1_966_720, 0x4A_8C_5A], // 致命公司 工业绿
  [2_050_650, 0xB2_2A_2A], // 生化危机4 红
  [2_073_620, 0x7A_8C_4A], // 暗区突围 战术绿
  [2_074_920, 0x3E_8C_D0], // 第一后裔 青蓝
  [2_139_460, 0x6E_9E_5A], // 七日世界 诡绿
  [2_183_900, 0x2E_5C_A8], // 星际战士2 群青
  [2_246_340, 0x4A_8C_7A], // 怪猎荒野 沙青
  [2_300_320, 0x6E_A8_2E], // 模拟农场25 拖拉机绿
  [2_379_780, 0xD0_41_3E], // 小丑牌 扑克红
  [2_399_830, 0xE0_8A_3A], // 方舟飞升 橙
  [2_483_190, 0x8C_5C_E0], // 地平线6 紫
  [2_507_950, 0x6E_8C_3A], // 三角洲 军绿
  [2_622_380, 0x8C_7A_3A], // 黑夜君临 暗金
  [2_694_490, 0xA8_3A_2E], // 流放之路2 绯红
  [2_767_030, 0xE0_38_2B], // 漫威争锋 漫威红
  [2_807_960, 0x2E_6E_9E], // 战地6 蓝
  [2_868_840, 0x9E_3A_4A], // 杀戮尖塔2 红紫
  [3_065_800, 0x2E_C4_C0], // Marathon 青
  [3_164_500, 0x5E_8C_4A], // Schedule I 暗绿
  [3_241_660, 0x4A_9E_8A], // R.E.P.O. 青绿
  [3_321_460, 0xB0_2A_2E], // 红色沙漠 绯红
  [3_405_690, 0x2E_9E_5A], // EA FC26 球场绿
  [3_472_040, 0xE0_7B_2A], // NBA2K26 篮球橙
  [3_513_350, 0x2E_B8_C4], // 鸣潮 青
  [3_527_290, 0xE0_92_2E], // PEAK 山橙
  [3_551_340, 0x2E_7C_5A], // 足球经理26 绿
  [3_564_740, 0x3E_9E_8A], // 燕云十六声 水墨青
  [3_932_890, 0x7A_6E_4A], // 逃离塔科夫 橄榄
  [218_230, 0x2E_8C_C4], // 行星边际2 青蓝
  [202_970, 0xC9_5A_2A], // 黑色行动2 橙
  [221_380, 0xB8_9A_4A], // 帝国时代2HD 金
  [219_640, 0x9E_45_38], // 骑士精神 钢红
  [200_710, 0xE8_A2_3A], // 火炬之光2 琥珀
  [1250, 0x9E_2E_2E], // 杀戮空间 暗红
  [232_090, 0xB0_2E_3A], // 杀戮空间2 绯红
  [200_510, 0x2E_7C_7A], // 幽浮未知敌人 青绿
  [219_740, 0x7A_68_50], // 饥荒 暗褐
  [113_200, 0x7A_5A_38], // 以撒 土褐
  [4920, 0x2E_9E_B0], // 自然选择2 青
  [65_800, 0x3E_6E_B0], // 地牢守护者 蓝
  [55_230, 0x8C_3E_B0], // 黑道圣徒3 紫
  [34_330, 0xCC_3A_30], // 幕府将军2 武士红
  [222_880, 0x8A_7A_3A], // 叛乱 卡其
  [8500, 0xD0_A8_3E], // EVE 星空金
  [17_080, 0x3E_8C_C4], // Tribes 科幻蓝
  [200_210, 0xC9_4A_8C], // RotMG 品红
  [204_300, 0x5A_B0_4A], // Awesomenauts 绿
  [99_900, 0x4A_8C_C4], // Spiral Knights 钢蓝
  [1_599_600, 0xE8_9A_3A], // PlateUp! 橙
  [1_240_440, 0x2E_7C_B0], // 光环无限 蓝
  [2_073_850, 0xE0_3A_4A], // THE FINALS 红
  [976_730, 0x4A_8C_3A], // 光环MCC 绿
  [1_238_810, 0x6E_8C_5A], // 战地5 橄榄
  [1_238_840, 0x9A_7A_4A], // 战地1 一战褐
  [686_810, 0x6E_6B_3A], // 人间地狱 军绿
  [393_380, 0x5A_6E_3A], // Squad 军绿
  [581_320, 0xB5_89_5A], // 叛乱沙暴 沙黄
  [1_144_200, 0x4A_5A_7A], // 严阵以待 战术蓝
  [291_550, 0x3E_7C_C4], // 英灵乱斗 蓝
  [1_778_820, 0x9E_3E_7A], // 铁拳8 紫
  [2_344_520, 0xB0_1E_1E], // 暗黑4 地狱红
  [899_770, 0x5A_6E_C0], // 最后纪元 时之蓝
  [632_360, 0xD9_72_2E], // 雨中冒险2 橙
  [306_130, 0xB5_91_2E], // 上古卷轴OL 金
  [2_054_970, 0xC2_5A_2E], // 龙之信条2 红
  [1_771_300, 0xA8_40_30], // 天国拯救2 波西米亚红
  [1_145_350, 0x6E_4A_9E], // 哈迪斯2 巫紫
  [588_650, 0x3E_A8_9A], // 死亡细胞 青
  [1_604_030, 0x8C_2A_3A], // 夜族崛起 血红
  [648_800, 0x3E_9E_B0], // 木筏求生 海蓝
  [242_760, 0x4A_7A_3E], // 森林 暗绿
  [264_710, 0x2E_88_C0], // 深海迷航 深蓝
  [962_130, 0x6E_A8_3A], // 禁闭求生 后院绿
  [1_621_690, 0xC9_92_3A], // 核心守护者 琥珀
  [1_782_210, 0xE0_5A_8C], // 螃蟹游戏 粉
  [2_881_650, 0x4A_9E_7A], // Content Warning 青绿
  [2_670_630, 0x3A_8C_C4], // 超市模拟器 蓝
  [281_990, 0x4A_5A_C0], // 群星 星蓝
  [779_340, 0xCC_40_30], // 全战三国 红
  [1_934_680, 0xC9_A2_3A], // 神话时代重述 金
  [1_677_280, 0x7A_6E_3A], // 英雄连3 橄榄
  [949_230, 0x3E_9E_7A], // 城市天际线2 青
  [270_880, 0xC2_50_3A], // 美卡 美国路红
  [2_429_640, 0x7A_5C_B0], // 王权与自由 紫金
  [2_001_120, 0xC8_5A_B0], // 双影奇境 橙紫
  [1_903_340, 0xB5_9A_4A], // 光与影33 金
  [1_282_100, 0xB5_72_2E], // 遗迹2 琥珀
  [1_361_210, 0x8C_2A_22], // 暗潮 40K暗红
  [1_623_660, 0xC9_9A_3A], // 传奇4 金
  [1_295_660, 0x3E_8C_9A], // 文明7 青金
  [2_456_740, 0x5A_B0_A0], // inZOI 生活青
  [2_479_810, 0x6E_7A_5A], // 灰区战争 灰绿
  [1_818_750, 0x3E_7C_C8], // MultiVersus 蓝
  [424_370, 0x8C_3E_5A], // Wolcen 暗红紫
  [680_420, 0xC9_5A_2E], // Outriders 橙
  [552_500, 0x7A_2E_22], // 末世鼠疫2 鼠疫暗红
  [1_466_860, 0x3E_5C_8C], // 帝国时代4 蓝
  [677_620, 0x3E_A8_C4], // Splitgate 传送青
  [629_760, 0x8A_4A_3A], // Mordhau 铁锈
  [646_570, 0x8C_5A_B0], // 杀戮尖塔 紫
  [323_190, 0x5A_8C_B0], // 冰汽时代 寒蓝
])

function steamColor(appid: string | undefined): number {
  const c = appid ? steamColorMap.get(Number(appid)) : undefined
  if (c !== undefined) {
    return c
  }
  const colorStr = appid ? colors(appid) : undefined
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x88_88_88
}

// 中英共用 steam.csv / steam-zh.csv（仅 game 列语言不同）。游戏名长，放左侧 label 更易读。
function makeSteamConfig(zh: boolean): Config {
  return new Config({
    // 身份用 appid（稳定键）→ 同一游戏一条连续柱；显示名用 game 列，可随时间变（CS:GO→CS2 原地重写）。
    id: 'appid',
    step: 'date',
    value: 'players',
    // 左侧 label = game 列（游戏名）。与 id 解耦后，game 列中途改名不会断柱，而是原地重写。
    label: 'game',
    topN: 18,
    showLabel: true, // 左侧 label = 游戏名（playground 端还需 showBarLabel，见 main.ts）
    getBarInfo: () => '',
    valueScale: { type: 'from-zero' },
    color: d => steamColor(d.raw?.appid),
    // 三处文本分工、互不重复：轴标题=度量单位（唯一出现「同时在线/Concurrent」处）、标题=主题、副标题=范围+来源。
    xAxisLabel: zh ? '同时在线玩家（月均）' : 'Concurrent Players (monthly avg)',
    title: zh ? 'Steam 最热门游戏' : 'Steam\'s Most Played Games',
    subtitle: zh ? '历代人气变迁 · 数据来源 SteamCharts' : 'Popularity over the years · Data: SteamCharts',
    getStepLabel: step => dayjs(step * 1000).format('YYYY-MM'),
    // 在线人数是离散计数 → 整数全数字（中英一致），不套万/亿。
    getValueLabel: d => numberFmt.format(d.value),
    getTickLabel: v => numberFmt.format(v),
  })
}

// ───────────────────────── 美股市值配色 ─────────────────────────
// key = 公司展示名（与 scripts/update-stocks-data.py 的 UNIVERSE、public/logos/ 文件名一致）。
// 取品牌色为主；同时出现在 topN 里的常驻巨头之间手动错开色相（蓝色扎堆时靠 logo 区分）。
const stockColorMap = new Map<string, number>([
  ['Apple', 0xA3_AA_AE],
  ['Microsoft', 0x00_A4_EF],
  ['Alphabet', 0x42_85_F4],
  ['Amazon', 0xFF_99_00],
  ['Nvidia', 0x76_B9_00],
  ['Meta', 0x08_66_FF],
  ['Broadcom', 0x9B_1C_31],
  ['Tesla', 0xE8_21_27],
  ['JPMorgan Chase', 0x11_7A_CA],
  ['Eli Lilly', 0xE1_25_1B],
  ['Visa', 0x1A_1F_71],
  ['ExxonMobil', 0xCE_11_26],
  ['Walmart', 0xFD_BB_30],
  ['Mastercard', 0xFF_5F_00],
  ['UnitedHealth', 0x00_26_77],
  ['Oracle', 0xF8_00_00],
  ['Johnson & Johnson', 0xCC_00_00],
  ['Procter & Gamble', 0x00_4B_8D],
  ['Home Depot', 0xF9_63_02],
  ['Costco', 0x00_5D_AA],
  ['Chevron', 0x00_66_B2],
  ['Coca-Cola', 0xF4_00_09],
  ['Bank of America', 0xE3_18_37],
  ['Citigroup', 0x05_6D_AE],
  ['SpaceX', 0x8B_5C_F6],
  ['Netflix', 0xE5_09_14],
  ['Salesforce', 0x00_A1_E0],
  ['AMD', 0xED_1C_24],
  ['PepsiCo', 0x00_4B_93],
  ['Adobe', 0xFA_0F_00],
  ['Qualcomm', 0x32_53_DC],
  ['Disney', 0x1A_75_CF],
  ['Cisco', 0x04_9F_D9],
  ['Intel', 0x00_71_C5],
  ['Pfizer', 0x00_93_D0],
  ['GE', 0x60_9E_E0],
  ['IBM', 0x05_30_AD],
  ['AT&T', 0x00_A8_E0],
  ['Verizon', 0xCD_04_0B],
  ['Wells Fargo', 0xD7_1E_28],
  ['McDonald\'s', 0xFF_C7_2C],
  ['AbbVie', 0x07_1D_49],
  ['Merck', 0x00_85_7C],
])

function stockColor(id: string): number {
  if (stockColorMap.has(id)) {
    return stockColorMap.get(id)!
  }
  const colorStr = colors(id)
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x88_88_88
}

// ───────────────────────── Danbooru series 主题色 ─────────────────────────
// key = CSV 的 tag 列（合并后的规范系列键，与 scripts/update-danbooru-series.py 的 FRANCHISES
// 键 / 独立标签一致，中英两版共用，故配色稳定）。取每作最具辨识度的主题色：招牌角色 / logo /
// 品牌色。未列入的长尾系列回退调色板。
const seriesColorMap = new Map<string, number>([
  ['touhou', 0xD1_3B_3B], // 东方 红白巫女
  ['fate', 0xC9_A2_27], // Fate FGO 金
  ['pokemon', 0xFF_CB_05], // 宝可梦 黄
  ['idolmaster', 0xE2_32_6B], // 偶像大师 红
  ['kantai_collection', 0x3C_6E_9C], // 舰队 钢蓝
  ['hololive', 0x00_B5_D8], // hololive 青
  ['blue_archive', 0x5B_B8_E8], // 碧蓝档案 光环蓝
  ['honkai_star_rail', 0x7B_6C_D0], // 崩铁 星紫
  ['honkai_impact_3rd', 0x4F_86_C6], // 崩坏3 蓝
  ['genshin_impact', 0x3F_B0_AC], // 原神 青绿
  ['fire_emblem', 0x3F_6F_B5], // 火纹 蓝
  ['final_fantasy', 0x4A_5C_8A], // FF 水晶蓝
  ['love_live', 0xE4_00_7F], // LoveLive! 品牌粉
  ['umamusume', 0xF0_6E_AA], // 赛马娘 粉
  ['arknights', 0xCF_8E_2A], // 明日方舟 琥珀
  ['vocaloid', 0x39_C5_BB], // 初音 葱青
  ['azur_lane', 0x1F_5F_A0], // 碧蓝航线 深蓝
  ['madoka', 0xE9_6A_9C], // 小圆 粉
  ['danganronpa', 0xE0_45_7B], // 弹丸论破 黑粉
  ['gundam', 0xC0_39_2B], // 高达 红
  ['persona', 0xD1_1E_1E], // P5 红黑
  ['nijisanji', 0x5A_4F_CF], // 彩虹社 紫
  ['zenless_zone_zero', 0xF5_C5_18], // 绝区零 黄黑
  ['bang_dream', 0xE9_60_9A], // 邦多利 粉
  ['girls\'_frontline', 0x4F_7D_8C], // 少前 暗青
  ['zelda', 0x5B_A0_50], // 塞尔达 海拉鲁绿
  ['girls_und_panzer', 0x8C_7B_3E], // 少战 军褐
  ['precure', 0xF4_5F_A0], // 光之美少女 亮粉
  ['kemono_friends', 0xF5_B8_41], // 兽娘 薮猫橙黄
  ['jojo', 0x8E_5B_A6], // JOJO 紫金
  ['granblue_fantasy', 0x3F_A0_D8], // 碧蓝幻想 天蓝
  ['one_piece', 0xD3_3A_2C], // 海贼王 红
  ['wuthering_waves', 0x3F_A9_A0], // 鸣潮 暗青金
  ['project_moon', 0x9C_3A_3A], // 月亮计划 暗红
  ['chainsaw_man', 0xE8_55_2D], // 电锯人 血橙
  ['yu-gi-oh!', 0x7E_5A_A0], // 游戏王 紫金
  ['boku_no_hero_academia', 0x4C_9E_6F], // 我英 绿谷绿
  ['goddess_of_victory:_nikke', 0x55_70_C0], // NIKKE 蓝
  ['neon_genesis_evangelion', 0x7A_4F_B0], // EVA 初号机紫
  ['league_of_legends', 0xC8_AA_6E], // 英雄联盟 金
  ['street_fighter', 0xE0_66_2A], // 街霸 橙红
  ['splatoon_(series)', 0x5B_C2_2E], // 喷射战士 墨绿
  ['ragnarok_online', 0x6F_A8_D6], // 仙境传说 蓝
  ['bocchi_the_rock!', 0xEC_7F_A0], // 孤独摇滚 一里粉
  ['mario_(series)', 0xE5_25_21], // 马里奥 红
  ['dragon_ball', 0xF0_94_1E], // 龙珠 道服橙
  ['project_sekai', 0x33_AE_CC], // 世界计划 青
  ['princess_connect!', 0xF2_A0_C0], // 公主连结 粉
  ['k-on!', 0xD9_6B_A0], // 轻音 茶时粉
  ['toaru_majutsu_no_index', 0x5C_77_C0], // 魔禁 蓝
  ['sword_art_online', 0x55_6F_C0], // 刀剑神域 蓝
  ['utau', 0xD6_5A_8A], // UTAU 重音粉
  ['marvel', 0xE6_24_29], // 漫威 红
  ['sousou_no_frieren', 0x6F_B3_9C], // 芙莉莲 青绿
  ['xenoblade', 0x3F_86_C6], // 异度神剑 蓝
  ['naruto', 0xE8_85_2A], // 火影 鸣人橙
  ['haruhi', 0xD9_53_4F], // 凉宫春日 臂章红
  ['lyrical_nanoha', 0xE8_6F_A0], // 奈叶 粉
  ['world_witches', 0xAF_A1_5A], // 强袭魔女 卡其
])

function seriesColor(tag: string | undefined): number {
  if (tag && seriesColorMap.has(tag)) {
    return seriesColorMap.get(tag)!
  }
  const colorStr = tag ? colors(tag) : undefined
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x88_88_88
}

// LMArena 各品类榜单共用的 Config 工厂：id=公司、logo、配色、bar 文案全一致，
// 只有标题 / 坐标轴 / topN / 数值格式不同。
interface ArenaOptions {
  title: string
  subtitle?: string
  xAxisLabel: string
  topN: number
  getValueLabel?: (d: { value: number }) => string
}

function makeArenaConfig(options: ArenaOptions): Config {
  return new Config({
    id: 'company',
    step: 'date',
    value: 'rating',
    label: '-',
    image: 'company',
    topN: options.topN,
    xAxisLabel: options.xAxisLabel,
    title: options.title,
    subtitle: options.subtitle,
    color: d => llmColor(d.id),
    // date 列为 Unix 秒，getStepLabel 里 ×1000 转毫秒（与 studio 一致）。
    getStepLabel: step => dayjs(step * 1000).format('YYYY-MM-DD'),
    // 有 logo 时公司由 icon 表达，不再重复公司名；无 logo 才回退 "model - company"。
    getBarInfo: d => textureMap.has(d.id) ? (d.raw?.model ?? d.id) : `${d.raw?.model ?? d.id} - ${d.id}`,
    // 省略时为 undefined，Config 内 `?? 默认格式化` 会兜底。
    getValueLabel: options.getValueLabel,
  })
}

export const DATASETS: DatasetDef[] = [
  {
    key: 'llm',
    label: 'LLM Chatbot Arena',
    file: '/llm.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'LLM Chatbot Arena',
      xAxisLabel: 'LMArena Elo Rating',
      topN: 16,
    }),
  },
  {
    // LMArena 是人类盲投 Elo（每日演化）；这条是 Artificial Analysis 的标准 benchmark
    // 综合分（统一口径），公司柱值 = 该公司截至当前已发布模型的最高 II 分（running max）。
    // 数据来自 scripts/update-aa-data.py。Data: Artificial Analysis.
    key: 'llm-aa',
    label: 'AA Intelligence',
    file: '/llm-aa.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'The Race for the Smartest AI',
      subtitle: 'Each lab\'s best model over time · Data: Artificial Analysis (artificialanalysis.ai)',
      xAxisLabel: 'Intelligence Index',
      topN: 16,
      getValueLabel: d => d.value.toFixed(1),
    }),
  },
  {
    key: 'llm-agent',
    label: 'Agent Arena',
    file: '/llm-agent.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'Agent Arena',
      xAxisLabel: 'LMArena Agent Win Rate %',
      topN: 8,
      getValueLabel: d => `${d.value.toFixed(1)}%`,
    }),
  },
  {
    key: 'llm-webdev',
    label: 'WebDev Arena',
    file: '/llm-webdev.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'WebDev Arena',
      xAxisLabel: 'LMArena WebDev Elo Rating',
      topN: 12,
    }),
  },
  {
    key: 'llm-vision',
    label: 'Vision Arena',
    file: '/llm-vision.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'Vision Arena',
      xAxisLabel: 'LMArena Vision Elo Rating',
      topN: 14,
    }),
  },
  {
    key: 'llm-search',
    label: 'Search Arena',
    file: '/llm-search.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'Search Arena',
      xAxisLabel: 'LMArena Search Elo Rating',
      topN: 8,
    }),
  },
  {
    key: 'llm-t2i',
    label: 'Text-to-Image Arena',
    file: '/llm-t2i.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => makeArenaConfig({
      title: 'Text-to-Image Arena',
      xAxisLabel: 'LMArena Text-to-Image Elo Rating',
      topN: 12,
    }),
  },
  {
    key: 'go',
    label: '围棋等级分 (WHR)',
    file: '/go.csv',
    makeConfig: () => new Config({
      id: 'player_name',
      label: '-',
      step: 'date',
      value: 'rating',
      color: 'country',
      valueScale: { type: 'from-delta', delta: 350 },
      topN: 12,
      maxRetentionTimeSec: 18,
      barInfoStyle: 'reverse',
      xAxisLabel: 'WHR 全历史等级分',
      title: '围棋等级分 (WHR)',
      getValueLabel: d => numberFmt.format(d.value),
      getValueExtra: (d) => {
        const w = Number(d.raw.win_count)
        const l = Number(d.raw.loss_count)
        const rate = w + l > 0 ? Math.floor((100 * w) / (w + l)) : 0
        return `${numberFmt.format(w)}-${numberFmt.format(l)} ${rate}%`
      },
      getBarInfo: (d) => {
        const age = Math.floor((d.step - dayjs(d.raw.birth_date).valueOf()) / (365 * 24 * 3600 * 1000))
        return `${d.id}(${age})`
      },
      getStepLabel: step => dayjs(step).format('YYYY-MM-DD'),
    }),
  },
  {
    key: 'gdp',
    label: '各国 GDP',
    file: '/gdp.csv',
    loadAssets: loadCountryFlags,
    makeConfig: () => makeGdpConfig(false),
  },
  {
    // 中文版：同一份 gdp.csv，国名显示中文 + 国旗。
    key: 'gdp-zh',
    label: '各国 GDP（中文）',
    file: '/gdp.csv',
    loadAssets: loadCountryFlags,
    makeConfig: () => makeGdpConfig(true),
  },
  // 各国 人口 / CO₂ / 军费（World Bank，scripts/update-worldbank-data.py）——同 GDP 的国旗 + region 配色。
  { key: 'wb-population', label: '各国人口', file: '/wb-population.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('population', false) },
  { key: 'wb-population-zh', label: '各国人口（中文）', file: '/wb-population.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('population', true) },
  { key: 'wb-co2', label: '各国 CO₂ 排放', file: '/wb-co2.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('co2', false) },
  { key: 'wb-co2-zh', label: '各国 CO₂ 排放（中文）', file: '/wb-co2.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('co2', true) },
  { key: 'wb-military', label: '各国军费', file: '/wb-military.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('military', false) },
  { key: 'wb-military-zh', label: '各国军费（中文）', file: '/wb-military.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('military', true) },
  // 能源 / 环保（OWID，scripts/update-worldbank-data.py）—— 中国均断层第一
  { key: 'wb-electricity', label: '各国发电量', file: '/wb-electricity.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('electricity', false) },
  { key: 'wb-electricity-zh', label: '各国发电量（中文）', file: '/wb-electricity.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('electricity', true) },
  { key: 'wb-solar', label: '各国太阳能发电', file: '/wb-solar.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('solar', false) },
  { key: 'wb-solar-zh', label: '各国太阳能发电（中文）', file: '/wb-solar.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('solar', true) },
  { key: 'wb-wind', label: '各国风能发电', file: '/wb-wind.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('wind', false) },
  { key: 'wb-wind-zh', label: '各国风能发电（中文）', file: '/wb-wind.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('wind', true) },
  { key: 'wb-ev', label: '各国新能源车销量', file: '/wb-ev.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('ev', false) },
  { key: 'wb-ev-zh', label: '各国新能源车销量（中文）', file: '/wb-ev.csv', loadAssets: loadCountryFlags, makeConfig: () => makeWbConfig('ev', true) },
  { key: 'wb-poverty', label: '各国极端贫困人口', file: '/wb-poverty.csv', loadAssets: loadCountryFlags, showBarLabel: true, makeConfig: () => makeWbConfig('poverty', false) },
  { key: 'wb-poverty-zh', label: '各国极端贫困人口（中文）', file: '/wb-poverty.csv', loadAssets: loadCountryFlags, showBarLabel: true, makeConfig: () => makeWbConfig('poverty', true) },
  {
    // Steam 热门游戏同时在线人数，数据来自 scripts/update-steam-data.py（SteamCharts 月均在线）。
    // 游戏名长 → 左侧 label；配色按 appid（raw.appid）查游戏主题色。
    key: 'steam',
    label: 'Steam 同时在线',
    file: '/steam.csv',
    showBarLabel: true,
    makeConfig: () => makeSteamConfig(false),
  },
  {
    key: 'steam-zh',
    label: 'Steam 同时在线（中文）',
    file: '/steam-zh.csv',
    showBarLabel: true,
    makeConfig: () => makeSteamConfig(true),
  },
  {
    // 美股大盘市值（market cap = 股价 × 流通股数），数据来自 scripts/update-stocks-data.py
    // （Yahoo Finance 月线复权价 + 流通股数：2009 后 SEC XBRL、2000–2009 SEC 老 10-K 封面，
    // 按拆股基准对齐）。2000-01 至今月度。SpaceX 上市前是私募轮估值、2026 上市后是真实市值。
    // 市值是绝对量，from-zero 才诚实（柱长 ∝ 真实市值）。Data: SEC EDGAR & Yahoo Finance.
    key: 'stocks',
    label: '美股市值',
    file: '/stocks.csv',
    loadAssets: loadCompanyLogos,
    makeConfig: () => new Config({
      id: 'company',
      step: 'date',
      value: 'marketcap',
      label: '-',
      image: 'company',
      topN: 15,
      valueScale: { type: 'from-zero' },
      xAxisLabel: 'Market Capitalization (USD)',
      title: 'US Stock Market Cap',
      subtitle: 'SEC EDGAR + Yahoo Finance · SpaceX pre-IPO = reported private valuations',
      color: d => stockColor(d.id),
      // date 列为 Unix 秒，×1000 转毫秒；月度采样用 YYYY-MM。
      getStepLabel: step => dayjs(step * 1000).format('YYYY-MM'),
      // logo 已表达品牌，bar 上补公司名（比 ticker 更易读）；无 logo 才回退「公司名 (ticker)」。
      getBarInfo: d => textureMap.has(d.id) ? d.id : `${d.id} (${d.raw?.ticker ?? ''})`,
      getValueLabel: d => formatUSD(d.value),
      getTickLabel: v => formatUSD(v),
    }),
  },
  // ── Danbooru 作品投稿数据集（数据来自 scripts/update-danbooru-series.py）──
  // 已按 FRANCHISES 合并同系列（fate/grand_order + fate_(series) + … → Fate），每稿对每个系列至多
  // 计一次；排除 `original`。配色按 raw.tag（规范系列键）查主题色。series 名放左侧 label、不再画在
  // 柱上（showBarLabel + getBarInfo:'' 配合 main.ts）。两个指标各出中英两版：
  //   · 累计榜  danbooru-series*      —— value = 累计总投稿数（从 0 起，柱长 ∝ 总量）
  //   · 增速榜  danbooru-series-growth* —— value = 近 12 个月新增和（当前投稿速度，谁正当红）
  ...makeDanbooruDatasets(),
]

interface DanbooruOpts { zh: boolean, growth: boolean, kind: 'series' | 'character', sfw?: boolean }

function makeDanbooruConfig({ zh, growth, kind, sfw = false }: DanbooruOpts): Config {
  const noun = kind === 'character' ? (zh ? '角色' : 'Characters') : (zh ? '作品' : 'Series')
  const sfwTag = sfw ? (zh ? ' · SFW' : ' (SFW)') : ''
  const title = (zh
    ? (growth ? `Danbooru ${noun}年度投稿热度` : `Danbooru ${noun}投稿数`)
    : (growth ? `Danbooru Trailing-Year New Posts by ${noun}` : `Danbooru Posts by ${noun}`)) + sfwTag
  const xAxisLabel = zh
    ? (growth ? '近一年新增投稿数' : '累计投稿数')
    : (growth ? 'New posts · trailing 12 mo' : 'Cumulative Posts')
  // SFW 版仅计 general+sensitive 分级（排除 questionable/explicit）。
  const sfwNote = sfw ? (zh ? '，仅 SFW（general+sensitive）' : ', SFW only (general + sensitive)') : ''
  const src = (kind === 'character'
    ? (zh ? '数据来源：Danbooru · 角色标签' : 'Source: Danbooru · character tags')
    : (zh
        ? '数据来源：Danbooru · 版权标签，已合并同系列、排除「原创」'
        : 'Source: Danbooru · copyright tags, same-series merged, excl. "original"')) + sfwNote
  return new Config({
    id: 'tag', // 稳定主键用规范 tag：引擎/配色都按它合并。显示名走 label，避免别名同名时颜色横跳。
    label: 'series', // 左侧 label = 显示名（CSV 的 series 列）；与 id 解耦，故别名同 series 名也不冲突
    step: 'date',
    value: 'count',
    topN: 20,
    valueScale: { type: 'from-zero' },
    // 作品有主题色表；角色无品牌色，seriesColor 自动回退调色板。
    color: d => seriesColor(d.raw?.tag),
    showLabel: true, // 左侧 label = 名字（playground 端还需 showBarLabel，见 main.ts）
    getBarInfo: () => '', // 名字只放左侧，不再画在柱上
    xAxisLabel,
    title,
    subtitle: src,
    // date 列为 Unix 秒，×1000 转毫秒；月度采样用 YYYY-MM。
    getStepLabel: step => dayjs(step * 1000).format('YYYY-MM'),
    // 投稿数是离散计数 → 整数全数字（中英一致），不套万/亿。
    getValueLabel: d => numberFmt.format(d.value),
    getTickLabel: v => numberFmt.format(v),
  })
}

function makeDanbooruDatasets(): DatasetDef[] {
  const variants: Array<{ key: string, label: string, file: string, opts: DanbooruOpts }> = [
    { key: 'danbooru-series', label: 'Danbooru 作品投稿数', file: '/danbooru-series.csv', opts: { zh: false, growth: false, kind: 'series' } },
    { key: 'danbooru-series-zh', label: 'Danbooru 作品投稿数（中文）', file: '/danbooru-series-zh.csv', opts: { zh: true, growth: false, kind: 'series' } },
    { key: 'danbooru-growth', label: 'Danbooru 投稿增速', file: '/danbooru-series-growth.csv', opts: { zh: false, growth: true, kind: 'series' } },
    { key: 'danbooru-growth-zh', label: 'Danbooru 投稿增速（中文）', file: '/danbooru-series-growth-zh.csv', opts: { zh: true, growth: true, kind: 'series' } },
    { key: 'danbooru-character', label: 'Danbooru 角色投稿数', file: '/danbooru-character.csv', opts: { zh: false, growth: false, kind: 'character' } },
    { key: 'danbooru-character-zh', label: 'Danbooru 角色投稿数（中文）', file: '/danbooru-character-zh.csv', opts: { zh: true, growth: false, kind: 'character' } },
    { key: 'danbooru-character-growth', label: 'Danbooru 角色增速', file: '/danbooru-character-growth.csv', opts: { zh: false, growth: true, kind: 'character' } },
    { key: 'danbooru-character-growth-zh', label: 'Danbooru 角色增速（中文）', file: '/danbooru-character-growth-zh.csv', opts: { zh: true, growth: true, kind: 'character' } },
    // SFW 版（仅 general+sensitive，排除 questionable/explicit）：与上面一一对应，文件名插 -sfw。
    { key: 'danbooru-series-sfw', label: 'Danbooru 作品投稿数（SFW）', file: '/danbooru-series-sfw.csv', opts: { zh: false, growth: false, kind: 'series', sfw: true } },
    { key: 'danbooru-series-sfw-zh', label: 'Danbooru 作品投稿数（SFW·中文）', file: '/danbooru-series-sfw-zh.csv', opts: { zh: true, growth: false, kind: 'series', sfw: true } },
    { key: 'danbooru-growth-sfw', label: 'Danbooru 投稿增速（SFW）', file: '/danbooru-series-growth-sfw.csv', opts: { zh: false, growth: true, kind: 'series', sfw: true } },
    { key: 'danbooru-growth-sfw-zh', label: 'Danbooru 投稿增速（SFW·中文）', file: '/danbooru-series-growth-sfw-zh.csv', opts: { zh: true, growth: true, kind: 'series', sfw: true } },
    { key: 'danbooru-character-sfw', label: 'Danbooru 角色投稿数（SFW）', file: '/danbooru-character-sfw.csv', opts: { zh: false, growth: false, kind: 'character', sfw: true } },
    { key: 'danbooru-character-sfw-zh', label: 'Danbooru 角色投稿数（SFW·中文）', file: '/danbooru-character-sfw-zh.csv', opts: { zh: true, growth: false, kind: 'character', sfw: true } },
    { key: 'danbooru-character-growth-sfw', label: 'Danbooru 角色增速（SFW）', file: '/danbooru-character-growth-sfw.csv', opts: { zh: false, growth: true, kind: 'character', sfw: true } },
    { key: 'danbooru-character-growth-sfw-zh', label: 'Danbooru 角色增速（SFW·中文）', file: '/danbooru-character-growth-sfw-zh.csv', opts: { zh: true, growth: true, kind: 'character', sfw: true } },
  ]
  return variants.map(v => ({
    key: v.key,
    label: v.label,
    file: v.file,
    showBarLabel: true,
    makeConfig: () => makeDanbooruConfig(v.opts),
  }))
}
