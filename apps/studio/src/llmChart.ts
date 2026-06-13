import { colors, textureMap } from '@anichart/core'
import { Texture } from 'pixi.js'
import { staticFile } from 'remotion'

// LLM 各榜单（Chatbot Arena / AA Intelligence …）共用的公司配色与 logo 加载。
// 公司展示名出自 scripts/update-llm-data.py，同时是 public/logos/ 下的文件名，
// 与 apps/playground/src/datasets.ts 的 llmColorMap 保持一致（含撞色调整后的柱色）。
export const llmColorMap = new Map<string, number>([
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

export function llmColor(id: string): number | undefined {
  if (llmColorMap.has(id)) {
    return llmColorMap.get(id)
  }
  const colorStr = colors(id)
  return colorStr ? Number.parseInt(colorStr.slice(1), 16) : 0x00_00_00
}

// 公司 logo：BarChart 构建时从 textureMap 取图，所以要先加载完。
// 透明底的单色 glyph（lobehub 图标）贴边太挤，加一圈透明边距；不透明的方形
// 头像（GitHub 组织头像等）保持贴边（与 playground 一致）。缺 logo 的公司静默跳过。
const LOGO_PADDING_RATIO = 0.14

export async function loadCompanyLogos(companies: string[]): Promise<void> {
  await Promise.all(companies.map(async (company) => {
    if (textureMap.has(company)) {
      return
    }
    try {
      const image = new Image()
      // 原始公司名直接交给 staticFile：Remotion 4.0 起 staticFile 自己会逐段 encodeURIComponent，
      // 若这里再手动编码会双重编码（"Hugging Face" → Hugging%2520Face.png → 404，logo 静默丢失）。
      image.src = staticFile(`logos/${company}.png`)
      await image.decode()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      canvas.width = image.width
      canvas.height = image.height
      ctx.drawImage(image, 0, 0)
      const { width: w, height: h } = canvas
      const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
      const isGlyph = corners.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 255)
      if (isGlyph) {
        const pad = Math.round(Math.max(w, h) * LOGO_PADDING_RATIO)
        canvas.width = w + pad * 2
        canvas.height = h + pad * 2
        canvas.getContext('2d')!.drawImage(image, pad, pad)
      }
      textureMap.set(company, Texture.from(canvas))
    }
    catch {
      // 没有 logo 的公司跳过
    }
  }))
}
