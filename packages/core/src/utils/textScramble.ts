// 文本「重写」动画：把一段文本从 from 渐变到 to，过程中尚未定型的字符位以随机字形闪烁
// （解码 / 黑客帝国风）。核心约束是**纯函数、无内部状态**：给定同一组 (from, to, progress,
// tick, key) 必返回同一字符串 —— 这样实时播放、Remotion 逐帧渲染、以及进度条任意跳转都确定可复现，
// 与「一切按帧预计算、update(frame) 只读」的渲染管线一致。
//
// 逐字符位（按下标对齐，即「汉明」式）处理，自动兼顾两种观感：
//   · 相同位（fromCh === toCh）始终保持不动 —— 小改动（如 "…(33)"→"…(34)"）只有变化的那一位在动；
//   · 不同位 / 新增位 / 删除位 —— 经历「旧字符 → 随机字形闪烁 → 新字符」的解码过程；
//   整串几乎全变（如 "GPT-4"→"Claude 3.5"）时近乎全屏重写，即黑客帝国式。

// 默认扰动字形池：大写字母 + 数字 + 符号，在等宽字体下像「代码雨」，且任何 mono 字体都渲染得出。
export const DEFAULT_SCRAMBLE_CHARS = String.raw`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>+=/\|{}[]~^`

// 确定性伪随机：把若干整数混进一个 32bit hash 后归一到 [0,1)。不依赖任何全局 RNG 状态。
function hash01(seed: number, ...nums: number[]): number {
  let h = (2_166_136_261 ^ (seed >>> 0)) >>> 0 // FNV-1a offset basis
  for (const n of nums) {
    h ^= Math.trunc(n) >>> 0
    h = Math.imul(h, 16_777_619) >>> 0
  }
  // 末轮再打散，削弱低位规律性
  h ^= h >>> 13
  h = Math.imul(h, 0x5B_D1_E9_95) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 4_294_967_296
}

// 字符串 → 稳定整数种子（同一 key 得到同一套逐位揭示时序，让每根柱子有一致的「性格」）。
function keySeed(key: string): number {
  let h = 2_166_136_261 >>> 0
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16_777_619) >>> 0
  }
  return h >>> 0
}

/**
 * 计算 from→to 过渡在 progress∈[0,1] 时刻的中间字符串。
 *
 * @param from     起始文本（progress≤0 时原样返回）
 * @param to       目标文本（progress≥1 时原样返回）
 * @param progress 过渡进度 [0,1]，由 帧差 / 时长帧数 得出
 * @param tick     驱动「闪烁」的整数（一般传帧差）：同一位在不同帧给出不同随机字形
 * @param key      逐位时序的种子来源（一般传该条目 id），保证可复现
 * @param chars    扰动字形池
 */
export function scrambleText(
  from: string,
  to: string,
  progress: number,
  tick: number,
  key: string,
  chars: string = DEFAULT_SCRAMBLE_CHARS,
): string {
  if (progress <= 0) {
    return from
  }
  if (progress >= 1 || from === to) {
    return to
  }
  const seed = keySeed(key)
  const glyphs = chars.length > 0 ? chars : DEFAULT_SCRAMBLE_CHARS
  const len = Math.max(from.length, to.length)
  let out = ''
  for (let i = 0; i < len; i += 1) {
    const fromCh = i < from.length ? from[i] : ''
    const toCh = i < to.length ? to[i] : ''
    if (fromCh === toCh) {
      // 该位没变：保持不动（汉明感的来源），与整体进度无关。
      out += toCh
      continue
    }
    // 每位的揭示窗口 [start, end)，按下标递增整体偏后 → 视觉上从左往右逐位定型；叠加少量抖动避免机械。
    const order = len > 1 ? i / (len - 1) : 0
    const start = 0.55 * order + 0.2 * hash01(seed, i, 1)
    const end = Math.min(1, start + 0.2 + 0.3 * hash01(seed, i, 2))
    if (progress < start) {
      out += fromCh // 还没轮到，保留旧字符
    }
    else if (progress >= end) {
      out += toCh // 已定型为新字符
    }
    else {
      // 扰动中：按 (位, 帧) 取随机字形，逐帧闪烁。
      out += glyphs[Math.floor(hash01(seed, i, tick + 3) * glyphs.length)]
    }
  }
  return out
}
