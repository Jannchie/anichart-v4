/* eslint-disable no-console */
// 逆序指标 A/B 实验脚本（临时，不进 src）：
//   在真实数据集上对比 swap 算法变体的 inversion / smoothness / reversal 指标。
//   变体：velocity (boost=0) / velocity-accel (boost=2, 现行默认) /
//        lookahead（目标 rank 相位前移 L 帧，惯性塑形不变）/ zero-phase（rank 序列零相位 blur）。
// 运行：pnpm --filter @anichart/core exec tsx bench-inversion.mts
import type { RankedData } from './src/Data'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { blur, csvParse, extent, InternSet, range } from 'd3'
import { Config } from './src/Config'
import { DataProcessor } from './src/DataProcessor'
import { computeInversionMetrics } from './src/utils/inversionMetric'

const P = DataProcessor as any

// ───────── processRows 复刻（到 fillRank + tail 为止，不跑 swap 算法） ─────────
function buildPreAlgoFrames(csvText: string, config: Config): RankedData[][] {
  const rawData = csvParse(csvText)
  const data = P.preprocess(rawData, config)
  const rawStepList = [...new InternSet(data.map((d: any) => d.step))]
  const [startStep, endStep] = extent(rawStepList as number[])
  if (typeof startStep !== 'number' || typeof endStep !== 'number') {
    throw new TypeError('bad steps')
  }
  const totalStep = endStep - startStep
  const totalSec = config.totalDurationSec
  const totalFrame = Math.max(1, Math.round(totalSec * config.fps))
  const stepSec = totalStep > 0 ? totalSec / totalStep : totalSec
  const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
  const transitionSteps = stepSec > 0 ? transitionDurationSec / stepSec : 0
  const samplers = P.buildSamplers(data, config, stepSec)
  const baselineScale = P.buildBaselineScale(data, config)
  const carrySteps = stepSec > 0 ? config.maxRetentionTimeSec / stepSec : 0
  const stepInterval = totalStep > 0 ? (endStep - startStep) / totalFrame : 0
  let stepList: number[]
  if (stepInterval > 0 && Number.isFinite(stepInterval)) {
    stepList = range(startStep, endStep, stepInterval)
    if (stepList.length === 0 || stepList.at(-1) !== endStep) {
      stepList.push(endStep)
    }
  }
  else {
    stepList = Array.from<number>({ length: totalFrame }).fill(startStep)
  }
  const result: RankedData[][] = P.fillRank(stepList, samplers, baselineScale, transitionSteps, carrySteps, config)
  const lastFrame = result.at(-1)
  if (lastFrame) {
    const tailSec = Math.max(2, config.swapDurationSec * 4)
    const swapFrames = Math.max(1, Math.round(tailSec * config.fps))
    for (let i = 0; i < swapFrames; i++) {
      result.push(lastFrame.map(d => ({ ...d })))
    }
  }
  return result
}

function cloneFrames(result: RankedData[][]): RankedData[][] {
  return result.map(f => f.map(d => ({ ...d })))
}

// 每个 id 的逐帧 target rank 序列（fillRank 排序得出的真实 rank）。
function buildRankSeries(result: RankedData[][]): Map<string, Float64Array> {
  const T = result.length
  const series = new Map<string, Float64Array>()
  for (let t = 0; t < T; t++) {
    for (const d of result[t]) {
      let arr = series.get(d.id)
      if (!arr) {
        arr = new Float64Array(T)
        series.set(d.id, arr)
      }
      arr[t] = d.rank
    }
  }
  return series
}

// runVelocity 复刻 + 可选 lookahead：target 取 t+L 帧的 rank（相位前移），惯性塑形不变。
const ACCEL_DIST_HALF = 2
function runVelocityLA(config: Config, result: RankedData[][], boost: number, lookaheadFrames: number): void {
  const T = result.length
  if (T === 0 || result[0].length === 0) {
    return
  }
  const rankSeries = lookaheadFrames > 0 ? buildRankSeries(result) : null
  const dt = 1 / config.fps
  const D = Math.max(1e-6, config.swapDurationSec)
  const maxAccel = 32 / (D * D)
  const minVel = 2 / D
  const topN = config.topN
  const visualRank = new Map<string, number>()
  const velocity = new Map<string, number>()
  const writeAlpha = (d: RankedData) => {
    const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
    d.alpha = Math.min(d.alpha, parkingMask)
  }
  const seed = (d: RankedData) => {
    visualRank.set(d.id, d.rank)
    velocity.set(d.id, 0)
    d.blurRank = d.rank
    writeAlpha(d)
  }
  for (const d of result[0]) {
    seed(d)
  }
  for (let t = 1; t < T; t++) {
    for (const d of result[t]) {
      if (!visualRank.has(d.id)) {
        seed(d)
        continue
      }
      const vrPrev = visualRank.get(d.id)!
      const target = rankSeries
        ? rankSeries.get(d.id)![Math.min(T - 1, t + lookaheadFrames)]
        : d.rank
      const dist = target - vrPrev
      const absDist = Math.abs(dist)
      const aEff = maxAccel * (1 + boost * (1 - 2 ** (-Math.max(0, absDist - 1) / ACCEL_DIST_HALF)))
      const maxDv = aEff * dt
      const desired = absDist < 1e-9 ? 0 : Math.sign(dist) * Math.max(minVel, Math.sqrt(2 * aEff * absDist))
      let v = velocity.get(d.id)!
      v += Math.max(-maxDv, Math.min(maxDv, desired - v))
      let vr = vrPrev + v * dt
      const overshot = (dist > 0 && vr > target) || (dist < 0 && vr < target)
      if (overshot || (Math.abs(target - vr) < 1e-4 && Math.abs(v) < minVel)) {
        vr = target
        v = 0
      }
      visualRank.set(d.id, vr)
      velocity.set(d.id, v)
      d.blurRank = vr
      writeAlpha(d)
    }
  }
}

// runVelocity + lookahead + 边界淡入淡出带限速：blurRank ∈ [topN-1, topN]（alpha 渐变带）内
// 限速 1/edgeFadeSec rank/s，让入退场穿越淡变带至少耗时 edgeFadeSec 秒（艺术减速）。
function _runVelocityLAEdge(config: Config, result: RankedData[][], boost: number, lookaheadFrames: number, edgeFadeSec: number, entryFadeSec = 0, entryExtraLA = 0): void {
  const T = result.length
  if (T === 0 || result[0].length === 0) {
    return
  }
  const rankSeries = lookaheadFrames > 0 ? buildRankSeries(result) : null
  const dt = 1 / config.fps
  const D = Math.max(1e-6, config.swapDurationSec)
  const maxAccel = 32 / (D * D)
  const minVel = 2 / D
  const edgeMaxVel = edgeFadeSec > 0 ? 1 / edgeFadeSec : Number.POSITIVE_INFINITY
  const entryMaxVel = entryFadeSec > 0 ? 1 / entryFadeSec : Number.POSITIVE_INFINITY
  const topN = config.topN
  const visualRank = new Map<string, number>()
  const velocity = new Map<string, number>()
  const writeAlpha = (d: RankedData) => {
    const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
    d.alpha = Math.min(d.alpha, parkingMask)
  }
  const seed = (d: RankedData) => {
    visualRank.set(d.id, d.rank)
    velocity.set(d.id, 0)
    d.blurRank = d.rank
    writeAlpha(d)
  }
  for (const d of result[0]) {
    seed(d)
  }
  for (let t = 1; t < T; t++) {
    for (const d of result[t]) {
      if (!visualRank.has(d.id)) {
        seed(d)
        continue
      }
      const vrPrev = visualRank.get(d.id)!
      // 入场柱（位于淡变带内或停车位）目标相位额外前移：早动身 + 慢速浮起，到位时间不变。
      const Leff = vrPrev > topN - 1 ? lookaheadFrames + entryExtraLA : lookaheadFrames
      const target = rankSeries
        ? rankSeries.get(d.id)![Math.min(T - 1, t + Leff)]
        : d.rank
      const dist = target - vrPrev
      const absDist = Math.abs(dist)
      const aEff = maxAccel * (1 + boost * (1 - 2 ** (-Math.max(0, absDist - 1) / ACCEL_DIST_HALF)))
      const maxDv = aEff * dt
      const desired = absDist < 1e-9 ? 0 : Math.sign(dist) * Math.max(minVel, Math.sqrt(2 * aEff * absDist))
      let v = velocity.get(d.id)!
      v += Math.max(-maxDv, Math.min(maxDv, desired - v))
      // 淡变带限速（非对称）：带内向下（退场，v>0）限 edgeMaxVel；向上（入场）限 entryMaxVel。
      if (vrPrev > topN - 1 && vrPrev < topN) {
        v = v > 0 ? Math.min(edgeMaxVel, v) : Math.max(-entryMaxVel, v)
      }
      let vr = vrPrev + v * dt
      const overshot = (dist > 0 && vr > target) || (dist < 0 && vr < target)
      if (overshot || (Math.abs(target - vr) < 1e-4 && Math.abs(v) < minVel)) {
        vr = target
        v = 0
      }
      visualRank.set(d.id, vr)
      velocity.set(d.id, v)
      d.blurRank = vr
      writeAlpha(d)
    }
  }
}

// 零相位方案：blurRank = 对每个 id 的 rank 序列做 d3.blur（非因果、零相位）。
function _runZeroPhase(config: Config, result: RankedData[][], radius: number): void {
  const T = result.length
  const rankSeries = buildRankSeries(result)
  const blurred = new Map<string, Float64Array>()
  for (const [id, arr] of rankSeries) {
    blurred.set(id, blur(Float64Array.from(arr), radius) as Float64Array)
  }
  const topN = config.topN
  for (let t = 0; t < T; t++) {
    for (const d of result[t]) {
      d.blurRank = blurred.get(d.id)![t]
      const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
      d.alpha = Math.min(d.alpha, parkingMask)
    }
  }
}

// ───────── 实验 ─────────
interface Variant {
  name: string
  run: (config: Config, frames: RankedData[][]) => void
}

const variants: Variant[] = [
  { name: '旧默认 (无 lookahead/fade)', run: (c, f) => {
    const cfg = Object.assign(Object.create(Object.getPrototypeOf(c)), c, { swapLookaheadFrames: 0, swapEnterFadeSec: 0, swapExitFadeSec: 0, swapEnterExtraFrames: 0 })
    DataProcessor.applyVelocityAccel(cfg, f)
  } },
  { name: '新默认 (LA + enter.3/exit.5)', run: (c, f) => DataProcessor.applyVelocityAccel(c, f) },
  { name: '新默认 + fade 关闭 (纯 LA)', run: (c, f) => {
    const cfg = Object.assign(Object.create(Object.getPrototypeOf(c)), c, { swapEnterFadeSec: 0, swapExitFadeSec: 0, swapEnterExtraFrames: 0 })
    DataProcessor.applyVelocityAccel(cfg, f)
  } },
]

interface DatasetSpec {
  name: string
  file: string
  makeConfig: () => Config
}

const root = '/home/jannchie/anichart-v4/apps/playground/public'
const datasets: DatasetSpec[] = [
  {
    name: 'go.csv (围棋 WHR，逐局锯齿)',
    file: path.resolve(root, 'go.csv'),
    makeConfig: () => new Config({
      id: 'player_name',
      label: '-',
      step: 'date',
      value: 'rating',
      color: 'country',
      valueScale: { type: 'from-delta', delta: 350 },
      topN: 12,
      maxRetentionTimeSec: 18,
    }),
  },
  {
    name: 'gdp.csv (年度稀疏)',
    file: path.resolve(root, 'gdp.csv'),
    makeConfig: () => new Config({
      id: 'country',
      step: 'year',
      value: 'gdp',
      label: '-',
      topN: 15,
      valueScale: { type: 'from-zero' },
    }),
  },
  {
    name: 'llm.csv (LLM Arena)',
    file: path.resolve(root, 'llm.csv'),
    makeConfig: () => new Config({
      id: 'company',
      step: 'date',
      value: 'rating',
      label: '-',
      topN: 16,
    }),
  },
]

// D-缩放验证：L_opt 是否 ≈ 0.175·D·fps（1-rank 行程时间 0.35·D 的一半）。
function dScalingCheck(): void {
  const csvText = readFileSync(path.resolve(root, 'gdp.csv'), 'utf8')
  for (const durationSec of [0.5, 0.8, 1.2]) {
    const config = new Config({
      id: 'country',
      step: 'year',
      value: 'gdp',
      label: '-',
      topN: 15,
      valueScale: { type: 'from-zero' },
      swap: { durationSec },
    })
    const base = buildPreAlgoFrames(csvText, config)
    const predicted = Math.round(0.175 * durationSec * config.fps)
    const rows: string[] = []
    for (const L of [0, predicted - 3, predicted - 1, predicted, predicted + 1, predicted + 3].filter(x => x >= 0)) {
      const frames = cloneFrames(base)
      runVelocityLA(config, frames, 2, L)
      const m = computeInversionMetrics(frames, { fps: config.fps })
      rows.push(`L=${String(L).padStart(2)} → invSec ${m.inversionSeconds.toFixed(2)}`)
    }
    console.log(`\nD=${durationSec}s (预测 L_opt=${predicted}f): ${rows.join(' | ')}`)
  }
}

for (const ds of datasets) {
  const config = ds.makeConfig()
  const csvText = readFileSync(ds.file, 'utf8')
  const t0 = performance.now()
  const base = buildPreAlgoFrames(csvText, config)
  const t1 = performance.now()
  const n = base[0]?.length ?? 0
  console.log(`\n=== ${ds.name} ===  frames=${base.length} samplers=${n} (pre-algo ${Math.round(t1 - t0)}ms)`)
  console.log('variant'.padEnd(38), 'invSec', '  pairSec', 'maxDepth', 'smooth', 'reversals')
  for (const v of variants) {
    const frames = cloneFrames(base)
    const ta = performance.now()
    v.run(config, frames)
    const tb = performance.now()
    const m = computeInversionMetrics(frames, { fps: config.fps })
    console.log(
      v.name.padEnd(38),
      m.inversionSeconds.toFixed(2).padStart(6),
      m.inversionPairSeconds.toFixed(2).padStart(9),
      String(m.maxDepth).padStart(9),
      m.smoothnessEnergy.toFixed(1).padStart(7),
      String(m.directionReversals).padStart(10),
      `(${Math.round(tb - ta)}ms)`,
    )
  }
}

dScalingCheck()
