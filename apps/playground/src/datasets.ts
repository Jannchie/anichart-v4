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
  ['Databricks', 0xFF_36_21],
  ['DeepSeek', 0x41_69_E1],
  ['Tencent', 0x16_8E_FF],
  ['MiniMax', 0xB1_65_FF],
  ['01.AI', 0x18_4B_39],
  ['AI2', 0x23_4F_1E],
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
  ['InternLM', 0x0B_46_50],
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
  ['Xiaomi', 0xFF_69_00],
  ['Meituan', 0xFF_D1_00],
  ['Ant Group', 0x16_77_FF],
  ['Inception AI', 0x7C_3A_ED],
  ['Prime Intellect', 0x00_B2_A9],
  ['Together AI', 0x0F_6F_FF],
  ['Arcee AI', 0xD2_3F_57],
  ['MosaicML', 0xE0_38_3D],
  ['Tsinghua', 0x66_08_74],
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

// LMArena 各品类榜单共用的 Config 工厂：id=公司、logo、配色、bar 文案全一致，
// 只有标题 / 坐标轴 / topN / 数值格式不同。
interface ArenaOptions {
  title: string
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
      title: 'Artificial Analysis Intelligence',
      xAxisLabel: 'Artificial Analysis Intelligence Index',
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
]
