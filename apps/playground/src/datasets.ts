import { colors, Config } from '@anichart/core'
import dayjs from 'dayjs'

// playground 可切换的数据集注册表。每个条目给出 CSV 路径与一个 Config 工厂
// （字段映射 + 配色 + 文案格式化）。切换数据集时重新 makeConfig() 并加载对应 CSV。

export interface DatasetDef {
  key: string
  label: string
  file: string
  makeConfig: () => Config
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// ───────────────────────── LLM Chatbot Arena ─────────────────────────
// 与 apps/studio/src/baseComposition.tsx 保持一致：同一份 llm.csv、同样以「公司」为
// id、同一张公司配色表、同样的 bar 信息（model - company）与坐标轴文案。
const llmColorMap = new Map<string, number>([
  ['OpenAI', 0x74_A8_9B],
  ['Google', 0xFE_51_4D],
  ['Anthropic', 0xD2_75_56],
  ['Meta', 0x00_5F_D5],
  ['微软', 0x00_A1_F1],
  ['Microsoft', 0x00_A1_F1],
  ['阿里巴巴', 0xFF_6C_00],
  ['Alibaba', 0xFF_6C_00],
  ['Mistral AI', 0xFF_70_00],
  ['亚马逊', 0xFF_99_00],
  ['Amazon', 0xFF_99_00],
  ['Databricks', 0xFF_36_21],
  ['深度求索', 0x41_69_E1],
  ['DeepSeek', 0x41_69_E1],
  ['腾讯', 0x16_8E_FF],
  ['Tencent', 0x41_69_E1],
  ['MiniMax', 0xB1_65_FF],
  ['MiniMax AI', 0xB1_65_FF],
  ['零一万物', 0x18_4B_39],
  ['01.AI', 0x18_4B_39],
  ['艾伦人工智能研究所（AI2）', 0x23_4F_1E],
  ['Allen Institute', 0x23_4F_1E],
  ['AI2', 0x23_4F_1E],
  ['英伟达', 0x76_B9_00],
  ['Nvidia', 0x76_B9_00],
  ['NVIDIA', 0x76_B9_00],
  ['IBM', 0x24_75_B2],
  ['技术创新研究院（TII）', 0x77_44_FF],
  ['TII', 0x77_44_FF],
  ['Perplexity AI', 0xAD_2E_FF],
  ['Cohere', 0xFF_D6_00],
  ['Cohere for AI', 0xFF_D6_00],
  ['Snowflake', 0x56_B9_FF],
  ['Upstage AI', 0xD7_3B_E2],
  ['Upstage', 0xD7_3B_E2],
  ['HuggingFace', 0xFF_D2_1F],
  ['Nous Research', 0x11_AA_99],
  ['Teknium', 0xA0_10_6E],
  ['LMSYS', 0x7A_00_D6],
  ['LMSys', 0x4D_76_A5],
  ['社区', 0x88_88_88],
  ['Tatsu Lab', 0x19_19_70],
  ['Stanford', 0xB1_04_0E],
  ['斯坦福大学', 0xB1_04_0E],
  ['BAIR', 0x1E_68_2E],
  ['Berkeley', 0x1E_68_2E],
  ['Nexusflow', 0xB2_15_56],
  ['上海人工智能实验室', 0x0B_46_50],
  ['Shanghai AI Laboratory', 0x0B_46_50],
  ['RWKV 社区', 0x9B_4F_C7],
  ['BlinkDL', 0x9B_4F_C7],
  ['LAION', 0xA3_C6_44],
  ['Reka AI', 0x78_3E_96],
  ['BAAI（QWQ 团队）', 0x18_A3_B6],
  ['Step', 0xFF_4F_81],
  ['Nomic AI', 0x4F_8A_C7],
  ['Cognitive Computations', 0xA9_96_7B],
  ['AI21 Labs', 0xD9_27_67],
  ['OpenChat', 0xA6_B1_15],
  ['Stability AI', 0x6B_4F_7F],
  ['xAI', 0x6B_4F_7F],
  ['智谱AI', 0x6B_4F_7F],
  ['Zhipu AI', 0x49_7A_9A],
  ['Moonshot', 0x32_63_DD],
])

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

export const DATASETS: DatasetDef[] = [
  {
    key: 'llm',
    label: 'LLM Chatbot Arena',
    file: '/llm.csv',
    makeConfig: () => new Config({
      id: 'company',
      step: 'date',
      value: 'rating',
      label: '-',
      topN: 16,
      xAxisLabel: 'LMSYS Chatbot Arena Elo Rating',
      title: 'LLM Chatbot Arena',
      color: d => llmColor(d.id),
      // date 列为 Unix 秒，getStepLabel 里 ×1000 转毫秒（与 studio 一致）。
      getStepLabel: step => dayjs(step * 1000).format('YYYY-MM-DD'),
      getBarInfo: d => `${d.raw?.model ?? d.id} - ${d.id}`,
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
    }),
  },
]
