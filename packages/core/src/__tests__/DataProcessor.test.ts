import type { Data, RankedData } from '../Data'
import { describe, expect, it } from 'vitest'
import { Config } from '../Config'
import { DataProcessor } from '../DataProcessor'
import { computeInversionMetrics } from '../utils/inversionMetric'

interface Segment {
  firstStep: number
  lastStep: number
  points: Data[]
}

interface Sampler {
  id: string
  label: string
  segments: Segment[]
}

interface SampleResult {
  value: number
  alpha: number
  raw: any
}

const buildSamplers = (DataProcessor as any).buildSamplers as (
  data: Data[],
  config: Config,
  stepSec: number,
) => Sampler[]

const buildBaselineScale = (DataProcessor as any).buildBaselineScale as (
  data: Data[],
  config: Config,
) => (step: number) => number

const sampleAtStep = (DataProcessor as any).sampleAtStep as (
  sampler: Sampler,
  step: number,
  baseline: number,
  transitionSteps: number,
  carrySteps?: number,
) => SampleResult

const fillRank = (DataProcessor as any).fillRank as (
  stepList: number[],
  samplers: Sampler[],
  baselineScale: (step: number) => number,
  transitionSteps: number,
  carrySteps: number,
  config: Config,
) => RankedData[][]

const addTailingFrames = (DataProcessor as any).addTailingFrames as (
  config: Config,
  result: RankedData[][],
) => void

const preprocess = (DataProcessor as any).preprocess as (
  rawData: any,
  config: Config,
) => Data[]

function createData(id: string, step: number, value: number, overrides: Partial<Data> = {}): Data {
  const base: Data = {
    id,
    label: overrides.label ?? id,
    value,
    step,
    alpha: overrides.alpha ?? 1,
    raw: overrides.raw ?? { id, step },
    up: overrides.up ?? false,
  }
  return Object.assign(base, overrides)
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

describe('dataprocessor.buildsamplers', () => {
  it('keeps consecutive points (gap ≤ maxretentiontimesec) in one segment', () => {
    const id = 'alpha'
    const data: Data[] = [
      createData(id, 0, 10),
      createData(id, 2, 12),
      createData(id, 4, 14),
    ]
    const config = new Config({ maxRetentionTimeSec: 5 })
    const samplers = buildSamplers(data, config, 1)
    expect(samplers).toHaveLength(1)
    expect(samplers[0].segments).toHaveLength(1)
    expect(samplers[0].segments[0].firstStep).toBe(0)
    expect(samplers[0].segments[0].lastStep).toBe(4)
    expect(samplers[0].segments[0].points).toHaveLength(3)
  })

  it('splits into multiple segments when gap exceeds maxretentiontimesec', () => {
    const id = 'beta'
    const data: Data[] = [
      createData(id, 0, 10),
      createData(id, 2, 12),
      createData(id, 20, 30),
      createData(id, 22, 32),
    ]
    const config = new Config({ maxRetentionTimeSec: 5 })
    const samplers = buildSamplers(data, config, 1)
    expect(samplers[0].segments).toHaveLength(2)
    expect(samplers[0].segments[0].lastStep).toBe(2)
    expect(samplers[0].segments[1].firstStep).toBe(20)
  })

  it('drops nan points (alpha=0 from preprocess) before segmenting', () => {
    const id = 'gamma'
    // 真实点：step=0, 6（短 gap 内）；中间 step=5 是 NaN，应被剔除。
    const data: Data[] = [
      createData(id, 0, 30),
      createData(id, 5, 0, { alpha: 0 }),
      createData(id, 6, 40),
    ]
    const config = new Config({ maxRetentionTimeSec: 10 })
    const samplers = buildSamplers(data, config, 1)
    expect(samplers[0].segments).toHaveLength(1)
    expect(samplers[0].segments[0].points.map(p => p.step)).toEqual([0, 6])
  })

  it('skips ids whose every point is nan', () => {
    const data: Data[] = [
      createData('x', 0, 0, { alpha: 0 }),
      createData('x', 1, 0, { alpha: 0 }),
    ]
    const config = new Config()
    const samplers = buildSamplers(data, config, 1)
    expect(samplers).toHaveLength(0)
  })
})

describe('dataprocessor.buildbaselinescale', () => {
  it('from-delta: baseline = topn_max − valuescaledelta', () => {
    const config = new Config({ topN: 2, valueScale: { type: 'from-delta', delta: 50 } })
    const data: Data[] = [
      createData('A', 0, 100),
      createData('B', 0, 80),
      createData('C', 0, 60),
      createData('D', 0, 40),
    ]
    const baseline = buildBaselineScale(data, config)
    // topN=2 → topN_max=100，baseline = 100 - 50 = 50
    expect(baseline(0)).toBe(50)
  })

  it('from-zero: baseline = 0 regardless of data range', () => {
    const config = new Config({ topN: 3, valueScale: { type: 'from-zero' } })
    const data: Data[] = [
      createData('A', 0, 100),
      createData('B', 0, 80),
      createData('C', 0, 60),
    ]
    const baseline = buildBaselineScale(data, config)
    expect(baseline(0)).toBe(0)
  })

  it('from-min: baseline = 2·datamin − datamax within topn', () => {
    const config = new Config({ topN: 3, valueScale: { type: 'from-min' } })
    const data: Data[] = [
      createData('A', 0, 100),
      createData('B', 0, 80),
      createData('C', 0, 60),
      createData('D', 0, 40), // 不在 topN 内
    ]
    const baseline = buildBaselineScale(data, config)
    // topN_min=60, topN_max=100 → baseline = 60 - (100-60) = 20
    expect(baseline(0)).toBe(20)
  })

  it('interpolates baseline between real steps', () => {
    const config = new Config({ topN: 2, valueScale: { type: 'from-delta', delta: 50 } })
    const data: Data[] = [
      createData('A', 0, 100),
      createData('B', 0, 50),
      createData('A', 10, 200),
      createData('B', 10, 150),
    ]
    const baseline = buildBaselineScale(data, config)
    expect(baseline(0)).toBe(50) // 100 - 50
    expect(baseline(10)).toBe(150) // 200 - 50
    expect(baseline(5)).toBeCloseTo(100, 5) // 线性中点
  })

  it('clamps outside the real-step range', () => {
    const config = new Config({ topN: 2, valueScale: { type: 'from-delta', delta: 50 } })
    const data: Data[] = [
      createData('A', 0, 100),
      createData('B', 0, 50),
      createData('A', 10, 200),
      createData('B', 10, 150),
    ]
    const baseline = buildBaselineScale(data, config)
    expect(baseline(-5)).toBe(50)
    expect(baseline(20)).toBe(150)
  })
})

describe('dataprocessor.sampleatstep', () => {
  const makeSampler = (points: Array<[number, number]>): Sampler => ({
    id: 'A',
    label: 'A',
    segments: [{
      firstStep: points[0][0],
      lastStep: points.at(-1)![0],
      points: points.map(([step, value]) => createData('A', step, value)),
    }],
  })

  it('returns inside-segment linear interpolation with alpha=1', () => {
    const sampler = makeSampler([[0, 10], [10, 20]])
    const mid = sampleAtStep(sampler, 5, 0, 2)
    // 线性 t=0.5 → value = (10 + 20) / 2 = 15
    expect(mid.value).toBeCloseTo(15, 5)
    expect(mid.alpha).toBe(1)

    const early = sampleAtStep(sampler, 2.5, 0, 2)
    // 线性 t=0.25 → value = 10 + 10 * 0.25 = 12.5（匀速，点处不顿挫）
    expect(early.value).toBeCloseTo(lerp(10, 20, 0.25), 5)
    expect(early.alpha).toBe(1)
  })

  it('enter region: value ramps from baseline (axis min) to firstvalue, alpha 0→1', () => {
    const sampler = makeSampler([[10, 100], [20, 200]])
    const transitionSteps = 4
    const baseline = 30 // 模拟当前帧 axis min
    // step = 10 - 2 = 8 → t = 0.5 → eased = 0.5
    const mid = sampleAtStep(sampler, 8, baseline, transitionSteps)
    expect(mid.value).toBeCloseTo(lerp(baseline, 100, 0.5), 5)
    expect(mid.alpha).toBeCloseTo(0.5, 5)
    // 起点：step = 6 → t = 0 → alpha = 0, value = baseline (轴底)
    const start = sampleAtStep(sampler, 6, baseline, transitionSteps)
    expect(start.value).toBeCloseTo(baseline, 5)
    expect(start.alpha).toBeCloseTo(0, 5)
  })

  it('exit region: value ramps from lastvalue to baseline (axis min), alpha 1→0', () => {
    const sampler = makeSampler([[0, 100], [10, 50]])
    const transitionSteps = 4
    const baseline = 5
    // step = 10 + 2 = 12 → t = 0.5
    const mid = sampleAtStep(sampler, 12, baseline, transitionSteps)
    expect(mid.value).toBeCloseTo(lerp(50, baseline, 0.5), 5)
    expect(mid.alpha).toBeCloseTo(0.5, 5)
    // 终点：step = 14 → t = 1 → alpha = 0, value = baseline
    const end = sampleAtStep(sampler, 14, baseline, transitionSteps)
    expect(end.value).toBeCloseTo(baseline, 5)
    expect(end.alpha).toBeCloseTo(0, 5)
  })

  it('carry region: holds lastvalue with alpha=1 until carrysteps elapses, then exits to baseline', () => {
    const sampler = makeSampler([[0, 100], [10, 50]])
    const transitionSteps = 4
    const carrySteps = 6
    const baseline = 5
    // carry 内：step=10 + 3 → 仍 alpha=1，value=lastValue
    const inCarry = sampleAtStep(sampler, 13, baseline, transitionSteps, carrySteps)
    expect(inCarry.value).toBeCloseTo(50, 5)
    expect(inCarry.alpha).toBe(1)
    // carry 终点：step=10 + 6 → 仍 alpha=1（边界含）
    const carryEnd = sampleAtStep(sampler, 16, baseline, transitionSteps, carrySteps)
    expect(carryEnd.value).toBeCloseTo(50, 5)
    expect(carryEnd.alpha).toBe(1)
    // 进入 exit：step = 10 + 6 + 2 → exit t=0.5
    const exitMid = sampleAtStep(sampler, 18, baseline, transitionSteps, carrySteps)
    expect(exitMid.value).toBeCloseTo(lerp(50, baseline, 0.5), 5)
    expect(exitMid.alpha).toBeCloseTo(0.5, 5)
    // exit 终点：step = 10 + 6 + 4 → alpha=0
    const exitEnd = sampleAtStep(sampler, 20, baseline, transitionSteps, carrySteps)
    expect(exitEnd.value).toBeCloseTo(baseline, 5)
    expect(exitEnd.alpha).toBeCloseTo(0, 5)
  })

  it('carry boundary: inside↔carry and carry↔exit transitions are continuous', () => {
    const sampler = makeSampler([[0, 100], [10, 50]])
    const transitionSteps = 4
    const carrySteps = 6
    const baseline = 5
    const insideEnd = sampleAtStep(sampler, 10, baseline, transitionSteps, carrySteps)
    const carryStart = sampleAtStep(sampler, 10 + 1e-6, baseline, transitionSteps, carrySteps)
    expect(insideEnd.value).toBeCloseTo(carryStart.value, 5)
    expect(insideEnd.alpha).toBeCloseTo(carryStart.alpha, 5)
    const carryEnd = sampleAtStep(sampler, 16, baseline, transitionSteps, carrySteps)
    const exitStart = sampleAtStep(sampler, 16 + 1e-6, baseline, transitionSteps, carrySteps)
    expect(carryEnd.value).toBeCloseTo(exitStart.value, 3)
    expect(carryEnd.alpha).toBeCloseTo(exitStart.alpha, 3)
  })

  it('outside all segments (before first / after last / between long-gap segments): alpha=0, value=baseline', () => {
    const sampler: Sampler = {
      id: 'A',
      label: 'A',
      segments: [
        { firstStep: 10, lastStep: 12, points: [createData('A', 10, 100), createData('A', 12, 110)] },
        { firstStep: 30, lastStep: 32, points: [createData('A', 30, 200), createData('A', 32, 210)] },
      ],
    }
    // 长 gap 中段（远离任何 transition）
    const between = sampleAtStep(sampler, 20, 42, 2)
    expect(between.value).toBeCloseTo(42, 5)
    expect(between.alpha).toBe(0)
    // 首段之前（远离 enter transition）
    const before = sampleAtStep(sampler, 0, 42, 2)
    expect(before.alpha).toBe(0)
    // 末段之后（远离 exit transition）
    const after = sampleAtStep(sampler, 50, 42, 2)
    expect(after.alpha).toBe(0)
  })

  it('value is continuous across enter ↔ inside ↔ exit boundaries', () => {
    const sampler = makeSampler([[10, 100], [20, 200]])
    const baseline = 30
    const trans = 4
    // 进入边界 step=10：enter 不含 first，inside 含。
    const enterEdge = sampleAtStep(sampler, 10 - 1e-6, baseline, trans)
    const insideEdge = sampleAtStep(sampler, 10, baseline, trans)
    expect(enterEdge.value).toBeCloseTo(insideEdge.value, 3)
    expect(enterEdge.alpha).toBeCloseTo(insideEdge.alpha, 3)
    // 退出边界 step=20：inside 含，exit 不含 last。
    const insideEnd = sampleAtStep(sampler, 20, baseline, trans)
    const exitStart = sampleAtStep(sampler, 20 + 1e-6, baseline, trans)
    expect(insideEnd.value).toBeCloseTo(exitStart.value, 3)
    expect(insideEnd.alpha).toBeCloseTo(exitStart.alpha, 3)
  })

  it('inside segment uses nearest raw based on local t', () => {
    const a = createData('A', 0, 10, { raw: { source: 'a' } })
    const b = createData('A', 10, 20, { raw: { source: 'b' } })
    const sampler: Sampler = {
      id: 'A',
      label: 'A',
      segments: [{ firstStep: 0, lastStep: 10, points: [a, b] }],
    }
    expect(sampleAtStep(sampler, 7, 0, 0).raw).toEqual({ source: 'b' })
    expect(sampleAtStep(sampler, 2, 0, 0).raw).toEqual({ source: 'a' })
  })
})

describe('dataprocessor.fillrank', () => {
  const constSampler = (id: string, value: number): Sampler => ({
    id,
    label: id,
    segments: [{
      firstStep: 0,
      lastStep: 10,
      points: [createData(id, 0, value), createData(id, 10, value)],
    }],
  })

  it('orders all bars by value desc and parks rank>=topn at config.topn', () => {
    const config = new Config({ topN: 2 })
    const samplers: Sampler[] = [
      constSampler('alpha', 12),
      constSampler('beta', 30),
      constSampler('delta', 20),
    ]
    const frames = fillRank([0], samplers, () => -100, 0, 0, config)
    expect(frames).toHaveLength(1)
    const [frame] = frames
    expect(frame.map(d => d.id)).toEqual(['beta', 'delta', 'alpha'])
    expect(frame[0].rank).toBe(0)
    expect(frame[1].rank).toBe(1)
    expect(frame[2].rank).toBe(config.topN)
  })

  it('clamps rank beyond topn to topn (parking 槽)', () => {
    // topN 内 unique 0..topN-1，topN 外全部停在 rank=topN（画面外一格）。
    const config = new Config({ topN: 2 })
    const samplers: Sampler[] = [
      constSampler('a', 50),
      constSampler('b', 40),
      constSampler('c', 30),
      constSampler('d', 20),
      constSampler('e', 10),
    ]
    const frames = fillRank([0], samplers, () => -100, 0, 0, config)
    expect(frames[0].map(d => d.rank)).toEqual([0, 1, 2, 2, 2])
    expect(frames[0].map(d => d.blurRank)).toEqual([0, 1, 2, 2, 2])
  })

  it('keeps an absent-segment bar (alpha=0) at parkrank with value=baseline', () => {
    // topN=1，2 个 sampler：alpha=1 的 alpha 占 rank=0；beta 在段外 alpha=0
    // 落到 idx=1，parked 到 config.topN=1。
    const config = new Config({ topN: 1 })
    const visible = constSampler('alpha', 50)
    const offscreen: Sampler = {
      id: 'beta',
      label: 'beta',
      segments: [{
        firstStep: 100,
        lastStep: 110,
        points: [createData('beta', 100, 999)],
      }],
    }
    const baseline = -5
    const frames = fillRank([0], [visible, offscreen], () => baseline, 0, 0, config)
    const [frame] = frames
    const visibleEntry = frame.find(d => d.id === 'alpha')!
    const offscreenEntry = frame.find(d => d.id === 'beta')!
    expect(visibleEntry.rank).toBe(0)
    expect(visibleEntry.alpha).toBe(1)
    expect(offscreenEntry.rank).toBe(config.topN)
    expect(offscreenEntry.alpha).toBe(0)
    expect(offscreenEntry.value).toBe(baseline)
  })
})

describe('dataprocessor.addtailingframes', () => {
  it('alpha 由 applyvelocity 按 blurrank 改写：parking (blurrank=topn) → alpha=0', () => {
    // 新设计：alpha 由 topN-blurRank clamp 决定，不再由 sampler 持有。
    const config = new Config({ topN: 2, swap: { durationSec: 1 }, fps: 2 })
    const createRanked = (step: number): RankedData => ({
      id: 'alpha',
      label: 'alpha',
      value: 10,
      step,
      alpha: 1, // 起始值无意义，会被 applyVelocity 覆盖
      raw: { id: 'alpha', step },
      up: false,
      rank: config.topN, // 停在 parking
      blurRank: config.topN,
    })
    const result: RankedData[][] = [
      [createRanked(0)],
      [createRanked(1)],
    ]

    addTailingFrames(config, result)
    const alphas = result.flat().map(d => d.alpha)
    for (const value of alphas) {
      expect(value).toBe(0)
    }
  })
})

describe('dataprocessor.applyvelocity', () => {
  const makeRanked = (
    id: string,
    rank: number,
    overrides: Partial<RankedData> = {},
  ): RankedData => ({
    id,
    label: id,
    value: overrides.value ?? 100 - rank,
    step: overrides.step ?? 0,
    alpha: overrides.alpha ?? 1,
    raw: overrides.raw ?? { id },
    up: overrides.up ?? false,
    rank,
    blurRank: 0,
    ...overrides,
  })

  type RankTuple = [string, number] | [string, number, number]
  const buildSegment = (
    fromStep: number,
    toStep: number,
    frames: number,
    ranksAt: (frameIdx: number) => RankTuple[],
  ): RankedData[][] => {
    const out: RankedData[][] = []
    for (let i = 0; i < frames; i++) {
      const t = frames > 1 ? i / (frames - 1) : 0
      const step = fromStep + t * (toStep - fromStep)
      out.push(ranksAt(i).map((tuple) => {
        const [id, rank, value] = tuple
        return makeRanked(id, rank, value === undefined ? { step } : { step, value })
      }))
    }
    return out
  }

  it('stationary: no rank change → blurrank ≡ rank', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const result = buildSegment(0, 1, 30, () => [['A', 0, 100], ['B', 1, 80], ['C', 2, 60]])
    DataProcessor.applyVelocity(config, result)
    for (const frame of result) {
      expect(frame[0].blurRank).toBe(0)
      expect(frame[1].blurRank).toBe(1)
      expect(frame[2].blurRank).toBe(2)
    }
  })

  it('1-rank swap: 对称守恒 a.blur + b.blur ≡ 1', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 120
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 50]]
      }
      return [['B', 0, 100], ['A', 1, 50]]
    })
    DataProcessor.applyVelocity(config, result)
    for (let t = 0; t < N; t++) {
      const a = result[t].find(d => d.id === 'A')!.blurRank
      const b = result[t].find(d => d.id === 'B')!.blurRank
      expect(a + b).toBeCloseTo(1, 5)
    }
  })

  it('1-rank swap: 在 swapdurationsec 内完成位移', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    // 30 帧 = swapDurationSec at fps=60。velocity 模型 1-rank 位移恰好耗时 D。
    const N = 120
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 50]]
      }
      return [['B', 0, 100], ['A', 1, 50]]
    })
    DataProcessor.applyVelocity(config, result)
    // t=30 (=fps × D) 应接近完成；放宽到 t=45 给离散误差留余量。
    expect(result[45].find(d => d.id === 'B')!.blurRank).toBeCloseTo(0, 2)
    expect(result[45].find(d => d.id === 'A')!.blurRank).toBeCloseTo(1, 2)
  })

  it('1-rank swap: 单调向 target 前进（无超调）', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 90
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 50]]
      }
      return [['B', 0, 100], ['A', 1, 50]]
    })
    DataProcessor.applyVelocity(config, result)
    // B 从 1 单调下降到 0（不会先超过 0 再回弹）。
    for (let t = 1; t < N; t++) {
      const cur = result[t].find(d => d.id === 'B')!.blurRank
      const prev = result[t - 1].find(d => d.id === 'B')!.blurRank
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      expect(cur).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('velocity smooth: 帧间速度变化 ≤ maxaccel × dt（除 touchdown 吸附帧）', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const D = config.swapDurationSec
    const fps = config.fps
    const dt = 1 / fps
    const maxAccel = 32 / (D * D)
    const maxDv = maxAccel * dt
    const N = 90
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 50]]
      }
      return [['B', 0, 100], ['A', 1, 50]]
    })
    DataProcessor.applyVelocity(config, result)
    // 推导出帧间速度：v_t = (blurRank_t - blurRank_{t-1}) / dt。
    // touchdown 吸附会产生一次性不连续（理论上界 ≈ √(2·a·maxVel·dt) ≈ 1.46 rank/s），可接受；
    // 但应仅出现在 1-2 帧，主体过程严格平滑。
    const blurs = result.map(f => f.find(d => d.id === 'B')!.blurRank)
    let exceptions = 0
    for (let t = 2; t < N; t++) {
      const v1 = (blurs[t - 1] - blurs[t - 2]) / dt
      const v2 = (blurs[t] - blurs[t - 1]) / dt
      if (Math.abs(v2 - v1) > maxDv * 1.5 + 1e-6) {
        exceptions++
      }
    }
    expect(exceptions).toBeLessThanOrEqual(2)
  })

  it('multi-rank jump: b 从 rank=3 直接降到 rank=0，单调收敛', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 5 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['C', 1, 80], ['D', 2, 60], ['B', 3, 40]]
      }
      return [['B', 0, 120], ['A', 1, 100], ['C', 2, 80], ['D', 3, 60]]
    })
    DataProcessor.applyVelocity(config, result)
    expect(result[0].find(d => d.id === 'B')!.blurRank).toBe(3)
    // 多 rank 跳跃理论时长 ≈ D + (Δ-1)/2 × D = 1.5D = 0.75s = 45 帧。给充足余量。
    expect(result.at(-1)!.find(d => d.id === 'B')!.blurRank).toBeCloseTo(0, 5)
    // B 全程单调下降。
    const blursB = result.map(f => f.find(d => d.id === 'B')!.blurRank)
    for (let t = 1; t < N; t++) {
      expect(blursB[t]).toBeLessThanOrEqual(blursB[t - 1] + 1e-9)
    }
  })

  it('multi-rank jump: 速度受三角峰值 √(2·a·n/2) 限制，不会无限加速', () => {
    // 新模型无 maxVel cap；峰值由 brakingVel 决定 = √(2·a·d_remaining)，
    // 最大可能峰值 = √(a·N) (在 d=N/2 处达到)。
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const D = config.swapDurationSec
    const fps = config.fps
    const dt = 1 / fps
    const maxAccel = 32 / (D * D)
    const nRank = 3
    const triangularPeak = Math.sqrt(maxAccel * nRank) // 3-rank 跳跃理论峰值
    const N = 5 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['C', 1, 80], ['D', 2, 60], ['B', 3, 40]]
      }
      return [['B', 0, 120], ['A', 1, 100], ['C', 2, 80], ['D', 3, 60]]
    })
    DataProcessor.applyVelocity(config, result)
    const blursB = result.map(f => f.find(d => d.id === 'B')!.blurRank)
    for (let t = 1; t < N; t++) {
      const v = Math.abs(blursB[t] - blursB[t - 1]) / dt
      // 允许 minVel 兜底和数值误差稍微宽松。
      expect(v).toBeLessThanOrEqual(triangularPeak * 1.05 + 1e-6)
    }
  })

  it('value reversal: target 反转 → 速度平滑反向，最终收敛到新 target', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const D = config.swapDurationSec
    const fps = config.fps
    const dt = 1 / fps
    const maxAccel = 32 / (D * D)
    const maxDv = maxAccel * dt
    const N = 120
    const result: RankedData[][] = []
    for (let i = 0; i < N; i++) {
      if (i === 0) {
        result.push([makeRanked('A', 0, { value: 100 }), makeRanked('B', 1, { value: 50 })])
      }
      else if (i < 15) {
        result.push([makeRanked('B', 0, { value: 100 }), makeRanked('A', 1, { value: 50 })])
      }
      else {
        result.push([makeRanked('A', 0, { value: 100 }), makeRanked('B', 1, { value: 50 })])
      }
    }
    DataProcessor.applyVelocity(config, result)
    // 最终回到原 rank。
    expect(result.at(-1)!.find(d => d.id === 'A')!.blurRank).toBeCloseTo(0, 2)
    expect(result.at(-1)!.find(d => d.id === 'B')!.blurRank).toBeCloseTo(1, 2)
    // 主体平滑；target 反转 2 次 + touchdown 共最多 ~4 帧例外。
    const blursA = result.map(f => f.find(d => d.id === 'A')!.blurRank)
    let exceptions = 0
    for (let t = 2; t < N; t++) {
      const v1 = (blursA[t - 1] - blursA[t - 2]) / dt
      const v2 = (blursA[t] - blursA[t - 1]) / dt
      if (Math.abs(v2 - v1) > maxDv * 1.5 + 1e-6) {
        exceptions++
      }
    }
    expect(exceptions).toBeLessThanOrEqual(4)
  })

  it('blurrank 全程不越界 [0, n-1]', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 6 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 80], ['C', 2, 60], ['D', 3, 40], ['E', 4, 20]]
      }
      return [['E', 0, 200], ['D', 1, 180], ['C', 2, 160], ['B', 3, 140], ['A', 4, 120]]
    })
    DataProcessor.applyVelocity(config, result)
    for (const frame of result) {
      for (const d of frame) {
        expect(d.blurRank).toBeGreaterThanOrEqual(-1e-9)
        expect(d.blurRank).toBeLessThanOrEqual(frame.length - 1 + 1e-9)
      }
    }
    const last = result.at(-1)!
    expect(last.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 5)
    expect(last.find(d => d.id === 'D')!.blurRank).toBeCloseTo(1, 5)
    expect(last.find(d => d.id === 'C')!.blurRank).toBeCloseTo(2, 5)
    expect(last.find(d => d.id === 'B')!.blurRank).toBeCloseTo(3, 5)
    expect(last.find(d => d.id === 'A')!.blurRank).toBeCloseTo(4, 5)
  })

  it('n > topn: topn 外 bar 升入 topn（rank unclamped, target 全局 unique）', () => {
    const config = new Config({ topN: 3, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 5 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['a', 0, 50], ['b', 1, 40], ['c', 2, 30], ['d', 3, 20], ['e', 4, 10]]
      }
      return [['e', 0, 100], ['a', 1, 50], ['b', 2, 40], ['c', 3, 30], ['d', 4, 20]]
    })
    DataProcessor.applyVelocity(config, result)
    const last = result.at(-1)!
    expect(last.find(d => d.id === 'e')!.blurRank).toBeCloseTo(0, 5)
    expect(last.find(d => d.id === 'a')!.blurRank).toBeCloseTo(1, 5)
    expect(last.find(d => d.id === 'b')!.blurRank).toBeCloseTo(2, 5)
    expect(last.find(d => d.id === 'c')!.blurRank).toBeCloseTo(3, 5)
    expect(last.find(d => d.id === 'd')!.blurRank).toBeCloseTo(4, 5)
    for (const frame of result) {
      for (const d of frame) {
        expect(d.blurRank).toBeGreaterThanOrEqual(-1e-9)
        expect(d.blurRank).toBeLessThanOrEqual(frame.length - 1 + 1e-9)
      }
    }
  })

  it('远距离 datarank 反转：所有 bar 立即朝各自 datarank 移动并收敛（不钉死在原位）', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 5 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 80], ['C', 2, 60], ['D', 3, 40], ['E', 4, 20]]
      }
      // E 飙到 rank=0：A→1, B→2, C→3, D→4, E→0
      return [['E', 0, 200], ['A', 1, 100], ['B', 2, 80], ['C', 3, 60], ['D', 4, 40]]
    })
    DataProcessor.applyVelocity(config, result)
    // 每根 bar 始终朝自己的真实 dataRank 移动：第一帧后即离开原位（A/B/C/D 下移、E 上移），
    // 不会因为"身位内暂无紧邻倒置对手"而被钉死在旧名次（被移除的 proximity 方案会钉死 → y 位置错乱）。
    expect(result[1].find(d => d.id === 'A')!.blurRank).toBeGreaterThan(0)
    expect(result[1].find(d => d.id === 'B')!.blurRank).toBeGreaterThan(1)
    expect(result[1].find(d => d.id === 'C')!.blurRank).toBeGreaterThan(2)
    expect(result[1].find(d => d.id === 'D')!.blurRank).toBeGreaterThan(3)
    expect(result[1].find(d => d.id === 'E')!.blurRank).toBeLessThan(4)
    // 最终全部收敛到各自 dataRank
    const last = result.at(-1)!
    expect(last.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 5)
    expect(last.find(d => d.id === 'A')!.blurRank).toBeCloseTo(1, 5)
    expect(last.find(d => d.id === 'B')!.blurRank).toBeCloseTo(2, 5)
    expect(last.find(d => d.id === 'C')!.blurRank).toBeCloseTo(3, 5)
    expect(last.find(d => d.id === 'D')!.blurRank).toBeCloseTo(4, 5)
  })

  it('未满榜入场：snap 到簇底、不从 topn 长途上滑，renderalpha 走 ramp 淡入', () => {
    // 簇内常驻 A/B/C（3 根，远小于 topN=8）。D 在 ENTER_AT 帧入场，value 始终 < C → 自然排在簇底 rank=3。
    // 期望：D 直接出现在簇底（snap），不再从屏外 rank=8 一路上滑；不透明度随 enter ramp 就地淡入；
    // A/B/C 完全不受影响（D 从底部出现，没有把谁挤开）。
    const config = new Config({ topN: 8, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 60
    const ENTER_AT = 20
    const RAMP = 12
    const rampAlpha = (t: number): number => Math.min(1, (t - ENTER_AT + 1) / RAMP)
    const result: RankedData[][] = []
    for (let i = 0; i < N; i++) {
      const dCell = i < ENTER_AT
        // 入场前：停车位 rank=topN、alpha=0。
        ? makeRanked('D', config.topN, { value: 10, alpha: 0 })
        // 入场中：value<C → 排在簇底 rank=3，alpha 为 ramp，打上 entering 标记。
        : makeRanked('D', 3, { value: 50, alpha: rampAlpha(i), entering: true })
      result.push([
        makeRanked('A', 0, { value: 100 }),
        makeRanked('B', 1, { value: 80 }),
        makeRanked('C', 2, { value: 60 }),
        dCell,
      ])
    }
    DataProcessor.applyVelocity(config, result)

    // 入场前一帧：D 仍停在 topN、renderAlpha=0（不可见）—— lookahead 没把它提前拽出停车位。
    const dPrev = result[ENTER_AT - 1].find(d => d.id === 'D')!
    expect(dPrev.blurRank).toBeCloseTo(config.topN, 5)
    expect(dPrev.renderAlpha).toBeCloseTo(0, 5)

    // 入场首帧：直接 snap 到簇底 rank=3（而非仍≈8 等着慢慢下滑）。
    expect(result[ENTER_AT].find(d => d.id === 'D')!.blurRank).toBeCloseTo(3, 5)

    // 入场全程：D 恒在簇底 3（value 不变、不挤动 A/B/C），renderAlpha 跟随 ramp 就地淡入（不是底边带给的 1）。
    for (let t = ENTER_AT; t < N; t++) {
      const dD = result[t].find(d => d.id === 'D')!
      expect(dD.blurRank).toBeCloseTo(3, 5)
      expect(dD.renderAlpha).toBeCloseTo(rampAlpha(t), 5)
    }

    // A/B/C 全程不受 D 入场影响：名次不变、renderAlpha 恒为 1（常驻、由纵向位置决定）。
    for (let t = 0; t < N; t++) {
      expect(result[t].find(d => d.id === 'A')!.blurRank).toBeCloseTo(0, 5)
      expect(result[t].find(d => d.id === 'B')!.blurRank).toBeCloseTo(1, 5)
      expect(result[t].find(d => d.id === 'C')!.blurRank).toBeCloseTo(2, 5)
      expect(result[t].find(d => d.id === 'A')!.renderAlpha).toBeCloseTo(1, 5)
    }
  })

  it('未满榜入场后 value 爬升超过他人：从簇底平滑换位上去（非逐帧硬跳）', () => {
    // D 先在簇底 rank=3 出现，CROSS 帧起 value 升过 C → D 应到 rank=2、C 退到 rank=3，且过程平滑、单调。
    const config = new Config({ topN: 8, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 240
    const ENTER_AT = 20
    const CROSS = 40
    const result: RankedData[][] = []
    for (let i = 0; i < N; i++) {
      const frame: RankedData[] = [makeRanked('A', 0, { value: 100 }), makeRanked('B', 1, { value: 80 })]
      if (i < ENTER_AT) {
        frame.push(makeRanked('C', 2, { value: 60 }), makeRanked('D', config.topN, { value: 10, alpha: 0 }))
      }
      else if (i < CROSS) {
        // D 入场、value=50 < C：簇底 rank=3。
        frame.push(makeRanked('C', 2, { value: 60 }), makeRanked('D', 3, { value: 50, alpha: 1, entering: true }))
      }
      else {
        // D value=70 升过 C：D→rank2、C→rank3。
        frame.push(makeRanked('D', 2, { value: 70, alpha: 1, entering: true }), makeRanked('C', 3, { value: 60 }))
      }
      result.push(frame)
    }
    DataProcessor.applyVelocity(config, result)

    // 入场首帧 snap 到 3。
    expect(result[ENTER_AT].find(d => d.id === 'D')!.blurRank).toBeCloseTo(3, 5)
    // 换位完成：D 收敛到 2、C 收敛到 3。
    expect(result.at(-1)!.find(d => d.id === 'D')!.blurRank).toBeCloseTo(2, 4)
    expect(result.at(-1)!.find(d => d.id === 'C')!.blurRank).toBeCloseTo(3, 4)
    // D 从 3 到 2 单调上行（不超调到 <2、不回弹），证明是平滑 velocity 换位而非硬跳/抖动。
    const blursD = result.slice(ENTER_AT).map(f => f.find(d => d.id === 'D')!.blurRank)
    for (let k = 1; k < blursD.length; k++) {
      expect(blursD[k]).toBeLessThanOrEqual(blursD[k - 1] + 1e-9)
      expect(blursD[k]).toBeGreaterThanOrEqual(2 - 1e-9)
    }
  })

  it('3-bar reshuffle: 中间 bar 不会停滞重叠', () => {
    // A=0,B=1,C=2 → C=0,B=1,A=2。B 的 target 不变（rank=1）但视觉上是「让位」过程。
    // velocity 模型：B 的 target 始终为 1，速度为 0，blurRank 一直 = 1，独立于 A/C 交换。
    const config = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const N = 5 * 60
    const result = buildSegment(0, 1, N, (i) => {
      if (i === 0) {
        return [['A', 0, 100], ['B', 1, 80], ['C', 2, 60]]
      }
      return [['C', 0, 120], ['B', 1, 100], ['A', 2, 80]]
    })
    DataProcessor.applyVelocity(config, result)
    // B 全程 ≈ 1（target 不变）。
    for (const frame of result) {
      const b = frame.find(d => d.id === 'B')!.blurRank
      expect(b).toBeCloseTo(1, 5)
    }
    // A、C 收敛到目标。
    const last = result.at(-1)!
    expect(last.find(d => d.id === 'C')!.blurRank).toBeCloseTo(0, 5)
    expect(last.find(d => d.id === 'A')!.blurRank).toBeCloseTo(2, 5)
  })
})

describe('dataprocessor.swapalgorithm.dispatch', () => {
  it('default config.swapalgorithm is "velocity-accel"', () => {
    expect(new Config().swapAlgorithm).toBe('velocity-accel')
  })

  it('addtailingframes dispatches to velocity and writes blurrank', () => {
    const config = new Config({ topN: 2, swap: { durationSec: 0.5 }, fps: 60 })
    const makeOne = (id: string, rank: number, value: number): RankedData => ({
      id,
      label: id,
      value,
      step: 0,
      alpha: 1,
      raw: { id },
      up: false,
      rank,
      blurRank: 0,
    })
    const result: RankedData[][] = [[makeOne('A', 0, 100), makeOne('B', 1, 80)]]
    addTailingFrames(config, result)
    expect(result.length).toBeGreaterThan(1) // 尾帧已补齐
    for (const frame of result) {
      for (const d of frame) {
        expect(typeof d.blurRank).toBe('number')
      }
    }
    expect(result[0].find(d => d.id === 'A')!.blurRank).toBe(0)
    expect(result[0].find(d => d.id === 'B')!.blurRank).toBe(1)
  })
})

describe('dataprocessor.preprocess', () => {
  it('retains label-like fields as strings even when numeric-looking', () => {
    const config = new Config({
      id: 'id',
      label: 'name',
      value: 'metric',
      step: 'step',
    })
    const rawData = [
      { id: '1', name: '01', metric: '10', step: '0' },
      { id: '2', name: '02', metric: '9', step: '0' },
    ]

    const processed = preprocess(rawData as any, config)
    expect(processed).toHaveLength(2)
    const entry = processed.find(d => d.id === '1')
    expect(entry).toBeDefined()
    expect(entry?.name).toBe('01')
    expect(typeof entry?.name).toBe('string')
    expect(entry?.metric).toBe(10)
  })
})

describe('dataprocessor.applyvelocityaccel', () => {
  // 按 value 自动定 rank 的真实帧构造器（等价 fillRank 的「排序 + parking」，但不依赖 sampler）。
  function framesFromValueFn(
    ids: string[],
    T: number,
    valueAt: (id: string, t: number) => number,
    topN: number,
  ): RankedData[][] {
    const out: RankedData[][] = []
    for (let t = 0; t < T; t++) {
      const arr = ids.map(id => ({ id, value: valueAt(id, t) }))
      arr.sort((a, b) => b.value - a.value)
      out.push(arr.map((e, idx) => ({
        id: e.id,
        label: e.id,
        value: e.value,
        step: t,
        alpha: 1,
        raw: { id: e.id },
        up: false,
        rank: Math.min(idx, topN),
        blurRank: 0,
      })))
    }
    return out
  }

  it('boost=0 严格退化为 velocity（逐帧 blurrank 完全一致）', () => {
    const valueAt = (id: string, t: number): number =>
      id === 'E' ? 10 + Math.min(1, t / 30) * 190 : ({ A: 100, B: 80, C: 60, D: 40 } as Record<string, number>)[id]
    const ids = ['A', 'B', 'C', 'D', 'E']
    const cfgV = new Config({ topN: 5, swap: { durationSec: 0.5 }, fps: 60 })
    const cfgA = new Config({ topN: 5, swap: { durationSec: 0.5, accelBoost: 0 }, fps: 60 })
    const fv = framesFromValueFn(ids, 200, valueAt, 5)
    const fa = framesFromValueFn(ids, 200, valueAt, 5)
    DataProcessor.applyVelocity(cfgV, fv)
    DataProcessor.applyVelocityAccel(cfgA, fa)
    for (const [t, element] of fv.entries()) {
      for (const d of element) {
        expect(fa[t].find(x => x.id === d.id)!.blurRank).toBeCloseTo(d.blurRank, 9)
      }
    }
  })

  it('steady state: value 不变 → 收敛到整数 rank 且全程不动', () => {
    const config = new Config({ topN: 5, swap: { durationSec: 0.5, accelBoost: 2 }, fps: 60 })
    const stable: Record<string, number> = { A: 100, B: 80, C: 60 }
    const frames = framesFromValueFn(['A', 'B', 'C'], 120, id => stable[id], 5)
    DataProcessor.applyVelocityAccel(config, frames)
    const last = frames.at(-1)!
    expect(last.find(d => d.id === 'A')!.blurRank).toBeCloseTo(0, 9)
    expect(last.find(d => d.id === 'B')!.blurRank).toBeCloseTo(1, 9)
    expect(last.find(d => d.id === 'C')!.blurRank).toBeCloseTo(2, 9)
  })

  it('暴涨 bar: accel 压逆序时间、保留惯性、且不引入抽搐（无关柱不抖）', () => {
    const topN = 5
    const T = 300
    const rampFrames = 30 // 0.5s 内从底冲到顶
    const stable: Record<string, number> = { A: 100, B: 80, C: 60, D: 40 }
    const valueAt = (id: string, t: number): number => {
      if (id === 'E') {
        const p = Math.min(1, t / rampFrames)
        return 10 + p * (200 - 10) // 10 → 200，之后保持
      }
      return stable[id]
    }
    const ids = ['A', 'B', 'C', 'D', 'E']
    const config = new Config({ topN, swap: { durationSec: 0.5, accelBoost: 2 }, fps: 60 })
    const framesVel = framesFromValueFn(ids, T, valueAt, topN)
    const framesAccel = framesFromValueFn(ids, T, valueAt, topN)
    DataProcessor.applyVelocity(config, framesVel)
    DataProcessor.applyVelocityAccel(config, framesAccel)

    const mVel = computeInversionMetrics(framesVel, { fps: 60 })
    const mAccel = computeInversionMetrics(framesAccel, { fps: 60 })

    // 对照组确有逆序，否则对比无意义。
    expect(mVel.inversionPairFrames).toBeGreaterThan(0)
    // 核心目标：逆序时间（逆序对×帧）显著下降。
    expect(mAccel.inversionPairFrames).toBeLessThan(mVel.inversionPairFrames)
    // 惯性保留：纵向运动仍有加减速能量，没有被压成瞬移/匀速。
    expect(mAccel.smoothnessEnergy).toBeGreaterThan(0)
    // 不抽搐：方向反转次数不超过 velocity（前馈方案会暴涨 10×+，accel 不会）。
    expect(mAccel.directionReversals).toBeLessThanOrEqual(mVel.directionReversals + 2)
    // 两者都收敛到正确终态：E 登顶。
    expect(framesVel.at(-1)!.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 2)
    expect(framesAccel.at(-1)!.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 2)
  })
})

describe('dataprocessor.lookahead 与底边淡变带限速', () => {
  // 按 value 自动定 rank 的帧构造器（与 applyvelocityaccel 块的同名 helper 一致）。
  function framesFromValueFn(
    ids: string[],
    T: number,
    valueAt: (id: string, t: number) => number,
    topN: number,
  ): RankedData[][] {
    const out: RankedData[][] = []
    for (let t = 0; t < T; t++) {
      const arr = ids.map(id => ({ id, value: valueAt(id, t) }))
      arr.sort((a, b) => b.value - a.value)
      out.push(arr.map((e, idx) => ({
        id: e.id,
        label: e.id,
        value: e.value,
        step: t,
        alpha: 1,
        raw: { id: e.id },
        up: false,
        rank: Math.min(idx, topN),
        blurRank: 0,
      })))
    }
    return out
  }

  // 每个 id 的 blurRank 序列。
  function seriesOf(frames: RankedData[][], id: string): number[] {
    return frames.map(f => f.find(d => d.id === id)!.blurRank)
  }

  it('config 派生：lookahead ≈ 0.175·d·fps − 1 帧，可显式覆盖/关闭', () => {
    expect(new Config({ swap: { durationSec: 0.8 }, fps: 60 }).swapLookaheadFrames).toBe(7)
    expect(new Config({ swap: { durationSec: 0.5 }, fps: 60 }).swapLookaheadFrames).toBe(4)
    expect(new Config({ swap: { durationSec: 1.2 }, fps: 60 }).swapLookaheadFrames).toBe(12)
    expect(new Config({ swap: { lookaheadSec: 0 } }).swapLookaheadFrames).toBe(0)
    expect(new Config({ swap: { lookaheadSec: 0.2 }, fps: 60 }).swapLookaheadFrames).toBe(12)
  })

  it('lookahead 只动相位：逆序时间显著下降，smoothness / reversal 与无 lookahead 完全一致', () => {
    const topN = 5
    const T = 400
    // 时间轴中段的暴涨：lookahead 有提前量可用（首帧换位对相位前移无感）。
    const stable: Record<string, number> = { A: 100, B: 80, C: 60, D: 40 }
    const valueAt = (id: string, t: number): number => {
      if (id === 'E') {
        const p = Math.max(0, Math.min(1, (t - 150) / 30))
        return 10 + p * (200 - 10)
      }
      return stable[id]
    }
    const ids = ['A', 'B', 'C', 'D', 'E']
    const cfgOff = new Config({ topN, swap: { durationSec: 0.8, lookaheadSec: 0, enterFadeSec: 0, exitFadeSec: 0 }, fps: 60 })
    const cfgOn = new Config({ topN, swap: { durationSec: 0.8, enterFadeSec: 0, exitFadeSec: 0 }, fps: 60 })
    const fOff = framesFromValueFn(ids, T, valueAt, topN)
    const fOn = framesFromValueFn(ids, T, valueAt, topN)
    DataProcessor.applyVelocityAccel(cfgOff, fOff)
    DataProcessor.applyVelocityAccel(cfgOn, fOn)
    const mOff = computeInversionMetrics(fOff, { fps: 60 })
    const mOn = computeInversionMetrics(fOn, { fps: 60 })
    expect(mOff.inversionPairFrames).toBeGreaterThan(0)
    expect(mOn.inversionPairFrames).toBeLessThan(mOff.inversionPairFrames * 0.6)
    // 相位前移不改变速度/加速度塑形：两条轨迹只差一个时移。
    expect(mOn.smoothnessEnergy).toBeCloseTo(mOff.smoothnessEnergy, 6)
    expect(mOn.directionReversals).toBe(mOff.directionReversals)
    expect(fOn.at(-1)!.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 2)
  })

  it('退场限速：穿越淡变带耗时 ≥ exitfadesec', () => {
    const topN = 3
    const T = 300
    // D 在 t=100 暴跌出榜：无限速时按 arrive 曲线 ~0.2s 内穿带，限速后 ≥ 1s。
    const valueAt = (id: string, t: number): number => {
      if (id === 'D') {
        return t < 100 ? 40 : 1
      }
      // C 初始低于 D：D 起始 rank=2（榜内），t=100 暴跌后被 C 顶替 → 穿越淡变带退场。
      return ({ A: 100, B: 80, C: 30, E: 20 } as Record<string, number>)[id]
    }
    const ids = ['A', 'B', 'C', 'D', 'E']
    const config = new Config({ topN, swap: { durationSec: 0.8, exitFadeSec: 1, enterFadeSec: 0 }, fps: 60 })
    const frames = framesFromValueFn(ids, T, valueAt, topN)
    DataProcessor.applyVelocityAccel(config, frames)
    const inBand = seriesOf(frames, 'D').filter(r => r > topN - 1 && r < topN).length
    // 1 rank @ ≤1 rank/s → ≈60 帧（入带前几帧未受限，留余量）。
    expect(inBand).toBeGreaterThanOrEqual(45)
    expect(frames.at(-1)!.find(d => d.id === 'D')!.blurRank).toBeCloseTo(topN, 5)
  })

  it('入场限速 + 额外相位前移：慢速浮起且按时到位收敛', () => {
    const topN = 3
    const T = 400
    const valueAt = (id: string, t: number): number => {
      if (id === 'E') {
        const p = Math.max(0, Math.min(1, (t - 150) / 30))
        return 10 + p * (200 - 10)
      }
      return ({ A: 100, B: 80, C: 60, D: 40 } as Record<string, number>)[id]
    }
    const ids = ['A', 'B', 'C', 'D', 'E']
    const config = new Config({ topN, swap: { durationSec: 0.8, enterFadeSec: 0.5, exitFadeSec: 0 }, fps: 60 })
    const frames = framesFromValueFn(ids, T, valueAt, topN)
    DataProcessor.applyVelocityAccel(config, frames)
    const sE = seriesOf(frames, 'E')
    // 暴涨柱无限速时以 >10 rank/s 闪现穿带（≈4 帧）；限速 2 rank/s → ≥ ~25 帧。
    const inBand = sE.filter(r => r > topN - 1 && r < topN).length
    expect(inBand).toBeGreaterThanOrEqual(20)
    expect(frames.at(-1)!.find(d => d.id === 'E')!.blurRank).toBeCloseTo(0, 2)
  })
})
