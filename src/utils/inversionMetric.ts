import type { RankedData } from '../Data'

// 逆序（inversion）= 渲染层 width(value) 与 y(blurRank) 的序错配：
//   某帧存在 bar i,j 使 value(i) > value(j) 但 blurRank(i) > blurRank(j)
//   —— 更长的 bar 却排在更短的 bar 下方。这是「新柱子突增、blurRank 滞后于 value」的直接观感缺陷。
// 本模块把它量化成可回归、可 A/B 的指标，作为调参目标函数。

export interface InversionOptions {
  fps: number
  // 只统计「看得见」的 bar：alpha 高于此阈值才计入（屏外 parking 的 alpha=0 自然被排除）。
  alphaEps?: number
  // value 差 / blurRank 差需各自超过对应 eps 才算一个「真」逆序对，过滤浮点噪声。
  valueEps?: number
  rankEps?: number
}

export interface InversionMetrics {
  // 至少含一个逆序对的帧数 / 秒数 —— 用户关心的「逆序时间」。
  inversionFrames: number
  inversionSeconds: number
  // Σ_frame 逆序对数：把「多深」也计入，越大越糟。
  inversionPairFrames: number
  inversionPairSeconds: number
  // 单帧最严重的逆序对数及其帧号，便于定位最糟时刻。
  maxDepth: number
  worstFrame: number
  // 惯性保真副指标：blurRank 二阶差分能量（加减速丰富度）。
  // 减逆序若把它压到接近 0，说明动画被压成匀速直冲、惯性被牺牲 —— 需与逆序指标一起看。
  smoothnessEnergy: number
  // 抽搐指标：blurRank 速度方向反转的总次数。稳态柱被前馈噪声推动会在原地上下抖 → 反转次数飙高。
  directionReversals: number
  totalFrames: number
}

// 单帧逆序对计数。O(n²)，n=可见 bar 数（topN 量级）。
function frameInversionPairs(
  frame: RankedData[],
  alphaEps: number,
  valueEps: number,
  rankEps: number,
): number {
  const vis = frame.filter(d => d.alpha > alphaEps)
  let pairs = 0
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]
      const b = vis[j]
      // value 大者应当 blurRank 小（在上方）。找出违反者。
      const hi = a.value >= b.value ? a : b
      const lo = a.value >= b.value ? b : a
      if (hi.value - lo.value > valueEps && hi.blurRank - lo.blurRank > rankEps) {
        pairs++
      }
    }
  }
  return pairs
}

// 每个 id 的 blurRank 时间序列。
function buildSeries(result: RankedData[][]): Map<string, number[]> {
  const series = new Map<string, number[]>()
  for (const frame of result) {
    for (const d of frame) {
      let arr = series.get(d.id)
      if (!arr) {
        arr = []
        series.set(d.id, arr)
      }
      arr.push(d.blurRank)
    }
  }
  return series
}

// blurRank 二阶差分能量：Σ_id Σ_t (blur[t+1] − 2·blur[t] + blur[t−1])²。
// 代表纵向运动的加减速强度；与逆序指标对照，确认减逆序没把惯性压平。
function computeSmoothnessEnergy(series: Map<string, number[]>): number {
  let energy = 0
  for (const arr of series.values()) {
    // 二阶差分需要 arr[t−1], arr[t], arr[t+1] 三点窗口。
    for (let t = 1; t < arr.length - 1; t++) {
      const accel = arr[t + 1] - 2 * arr[t] + arr[t - 1]
      energy += accel * accel
    }
  }
  return energy
}

// 抽搐：blurRank 速度方向反转次数。稳态柱被前馈噪声推动会原地上下抖 → 反转飙高。
// 速度幅度低于 eps（rank/帧）的帧视为静止，沿用上一方向，不计入反转。
function computeDirectionReversals(series: Map<string, number[]>, eps = 1e-4): number {
  let reversals = 0
  for (const arr of series.values()) {
    let prevDir = 0
    // 一阶差分的符号变化计数，需相邻两元素索引。
    for (let t = 1; t < arr.length; t++) {
      const delta = arr[t] - arr[t - 1]
      if (Math.abs(delta) < eps) {
        continue
      }
      const dir = Math.sign(delta)
      if (prevDir !== 0 && dir !== prevDir) {
        reversals++
      }
      prevDir = dir
    }
  }
  return reversals
}

export function computeInversionMetrics(
  result: RankedData[][],
  options: InversionOptions,
): InversionMetrics {
  const { fps } = options
  const alphaEps = options.alphaEps ?? 1e-3
  const valueEps = options.valueEps ?? 1e-9
  const rankEps = options.rankEps ?? 1e-3

  let inversionFrames = 0
  let inversionPairFrames = 0
  let maxDepth = 0
  let worstFrame = -1

  for (const [t, frame] of result.entries()) {
    const pairs = frameInversionPairs(frame, alphaEps, valueEps, rankEps)
    if (pairs > 0) {
      inversionFrames++
      inversionPairFrames += pairs
      if (pairs > maxDepth) {
        maxDepth = pairs
        worstFrame = t
      }
    }
  }

  const series = buildSeries(result)
  return {
    inversionFrames,
    inversionSeconds: fps > 0 ? inversionFrames / fps : 0,
    inversionPairFrames,
    inversionPairSeconds: fps > 0 ? inversionPairFrames / fps : 0,
    maxDepth,
    worstFrame,
    smoothnessEnergy: computeSmoothnessEnergy(series),
    directionReversals: computeDirectionReversals(series),
    totalFrames: result.length,
  }
}
