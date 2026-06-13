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
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

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
// key = 原始 danbooru copyright 标签（CSV 的 tag 列，中/英版一致，故配色稳定）。
// 取每个作品最具辨识度的主题色：招牌角色 / logo / 品牌色。未列入的长尾系列回退调色板。
const seriesColorMap = new Map<string, number>([
  ['touhou', 0xD1_3B_3B], // 东方 红白巫女
  ['kantai_collection', 0x3C_6E_9C], // 舰队 钢蓝
  ['blue_archive', 0x5B_B8_E8], // 碧蓝档案 光环蓝
  ['fate_(series)', 0x3A_6E_A5], // Fate Saber 蓝
  ['fate/stay_night', 0x45_70_A0],
  ['fate/grand_order', 0xC9_A2_27], // FGO 金
  ['pokemon', 0xFF_CB_05], // 宝可梦 黄
  ['pokemon_(anime)', 0xF2_B5_0A],
  ['pokemon_swsh', 0xC0_3A_3A],
  ['pokemon_sv', 0x8E_5BA_6 & 0xFF_FF_FF],
  ['hololive', 0x00_B5_D8], // hololive 青
  ['hololive_english', 0x00_8C_A8],
  ['genshin_impact', 0x3F_B0_AC], // 原神 青绿
  ['idolmaster', 0xE2_32_6B], // 偶像大师 红
  ['idolmaster_cinderella_girls', 0x2B_9F_E0], // CG 蓝
  ['idolmaster_shiny_colors', 0x5A_B0_D6],
  ['idolmaster_(classic)', 0xD1_3E_72],
  ['umamusume', 0xF0_6E_AA], // 赛马娘 粉
  ['arknights', 0xE0_A2_3B], // 明日方舟 琥珀
  ['vocaloid', 0x39_C5_BB], // 初音 葱青
  ['utau', 0xD6_5A_8A],
  ['honkai_(series)', 0x6C_8C_D5], // 崩坏 蓝紫
  ['honkai_impact_3rd', 0x4F_86_C6],
  ['honkai:_star_rail', 0x7B_6C_D0], // 星铁 星紫
  ['azur_lane', 0x1F_5F_A0], // 碧蓝航线 深蓝
  ['love_live!', 0xE4_00_7F], // LoveLive! 品牌粉
  ['love_live!_school_idol_project', 0xF3_98_00], // μ's 橙
  ['link!_like!_love_live!', 0xC5_4D_9E],
  ['fire_emblem', 0x3F_6F_B5], // 火纹 蓝
  ['fire_emblem_heroes', 0x4F_7F_C5],
  ['final_fantasy', 0x4A_5C_8A], // FF 水晶蓝
  ['final_fantasy_vii', 0x4F_A0_8A], // FF7 魔晄绿
  ['final_fantasy_xiv', 0x5A_6C_99],
  ['zenless_zone_zero', 0xF5_C5_18], // 绝区零 黄黑
  ['nijisanji', 0x5A_4F_CF], // 彩虹社 紫
  ['indie_virtual_youtuber', 0x7C_A8_9C], // 个人势 中性青
  ['mahou_shoujo_madoka_magica', 0xE9_6A_9C], // 小圆 粉
  ['mahou_shoujo_madoka_magica_(anime)', 0xE0_60_8E],
  ["girls'_frontline", 0x4F_7D_8C], // 少前 暗青
  ['girls_und_panzer', 0x9C_8A_4E], // 少战 军绿
  ['gundam', 0xC0_39_2B], // 高达 红
  ['danganronpa_(series)', 0xD6_4C_7F], // 弹丸论破 黑粉
  ['precure', 0xF4_5F_A0], // 光之美少女 亮粉
  ['kemono_friends', 0xF0_A8_30], // 兽娘 薮猫橙
  ['jojo_no_kimyou_na_bouken', 0x8E_5B_A6], // JOJO 紫金
  ['granblue_fantasy', 0x4F_A3_D1], // 碧蓝幻想 天蓝
  ['one_piece', 0xD3_3A_2C], // 海贼王 红
  ['bang_dream!', 0xE9_60_9A], // 邦多利 粉
  ["bang_dream!_it's_mygo!!!!!", 0x6E_8FB_0 & 0xFF_FF_FF], // MyGO 忧郁蓝
  ['wuthering_waves', 0x3F_A9_A0], // 鸣潮 暗青金
  ['persona', 0xD1_1E_1E], // P5 红黑
  ['project_moon', 0x9C_3A_3A], // 边狱 暗红
  ['chainsaw_man', 0xE8_5A_2A], // 电锯人 血橙
  ['yu-gi-oh!', 0x7E_5A_A0], // 游戏王 紫金
  ['boku_no_hero_academia', 0x4C_9E_6F], // 我英 绿谷绿
  ['goddess_of_victory:_nikke', 0x55_70_C0], // NIKKE 蓝
  ['the_legend_of_zelda', 0x5B_A0_50], // 塞尔达 海拉鲁绿
  ['neon_genesis_evangelion', 0x7A_4F_B0], // EVA 初号机紫
  ['league_of_legends', 0xC8_AA_6E], // 英雄联盟 金
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
    makeConfig: () => new Config({
      id: 'country',
      step: 'year',
      value: 'gdp',
      color: 'region',
      label: '-',
      topN: 15,
      // GDP 是绝对量，从 0 起更诚实；adaptive 在 US 极度领先时会把下界压成负数。
      valueScale: { type: 'from-zero' },
      xAxisLabel: 'GDP (current US$)',
      title: '各国 GDP',
      getStepLabel: step => String(Math.round(step)),
      getValueLabel: d => formatUSD(d.value),
      getTickLabel: v => formatUSD(v),
    }),
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
      // 有 logo 时公司由 icon 表达，bar 上只补 ticker；无 logo 才回退「公司名 (ticker)」。
      getBarInfo: d => textureMap.has(d.id) ? (d.raw?.ticker ?? d.id) : `${d.id} (${d.raw?.ticker ?? ''})`,
      getValueLabel: d => formatUSD(d.value),
      getTickLabel: v => formatUSD(v),
    }),
  },
  {
    // Danbooru 各 series（版权作品）累计投稿数，数据来自 scripts/update-danbooru-series.py
    // （本地 Danbooru 元数据 SQLite 的 posts.tag_string_copyright，按 created_at 月份累计）。
    // 一稿可属多个 series（联动图各计一次）；已排除 `original`（原创/无版权标记，量级碾压）。
    // 累计计数是绝对量，from-zero 才诚实（柱长 ∝ 总投稿数）。Data: Danbooru.
    key: 'danbooru-series',
    label: 'Danbooru 作品投稿数',
    file: '/danbooru-series.csv',
    makeConfig: () => new Config({
      id: 'series',
      step: 'date',
      value: 'count',
      label: '-',
      topN: 15,
      valueScale: { type: 'from-zero' },
      xAxisLabel: 'Cumulative Posts',
      title: 'Danbooru Posts by Series',
      subtitle: 'Source: Danbooru · copyright tags, excl. "original"',
      // date 列为 Unix 秒，×1000 转毫秒；月度采样用 YYYY-MM。
      getStepLabel: step => dayjs(step * 1000).format('YYYY-MM'),
      getValueLabel: d => numberFmt.format(d.value),
      getTickLabel: v => numberFmt.format(v),
    }),
  },
]
