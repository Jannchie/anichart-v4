/* eslint-disable no-console */
import type { DSVRowArray } from 'd3'
import type { Config, SwapAlgorithmName } from './Config'
import type { Data, RankedData } from './Data'
import { csv, extent, group, InternSet, range, scaleLinear } from 'd3'

type SwapAlgorithm = (config: Config, result: RankedData[][]) => void

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

type BaselineFn = (step: number) => number

const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export class DataProcessor {
  static async processCSV(path: string, config: Config): Promise<RankedData[][]> {
    const rawData = await csv(path)
    return DataProcessor.processRows(rawData, config)
  }

  static processRows(rawData: DSVRowArray<string>, config: Config): RankedData[][] {
    console.time('process')
    const data = DataProcessor.preprocess(rawData, config)
    console.timeEnd('process')
    const rawStepList = [...new InternSet(data.map(d => d.step))]
    const [startStep, endStep] = extent(rawStepList)
    if (typeof startStep !== 'number' || typeof endStep !== 'number') {
      throw new TypeError('startStep and endStep must be number')
    }
    const totalStep = endStep - startStep
    const totalSec = config.totalDurationSec
    const totalFrame = Math.max(1, Math.round(totalSec * config.fps))
    const stepSec = totalStep > 0 ? totalSec / totalStep : totalSec
    const maxTransitionDuration = config.maxRetentionTimeSec / 2
    const transitionDurationSec = Math.min(config.transitionDurationSec, maxTransitionDuration)
    if (transitionDurationSec !== config.transitionDurationSec) {
      console.warn('transitionDurationSec * 2 > maxRetentionTimeSec, using maxRetentionTimeSec / 2 instead')
    }
    const transitionSteps = stepSec > 0 ? transitionDurationSec / stepSec : 0

    console.time('samplers')
    const samplers = DataProcessor.buildSamplers(data, config, stepSec)
    console.timeEnd('samplers')
    console.time('baseline')
    const baselineScale = DataProcessor.buildBaselineScale(data, config)
    console.timeEnd('baseline')

    // carry-forward 保留窗口：与 buildSamplers 的段内 gap 容忍度对称，
    // 取 maxRetentionTimeSec。一个 id 最后一次出现后，在此窗口内继续以 lastValue 留在榜上，
    // 超出窗口才进入 transitionDurationSec 的 fade-out。
    const carrySteps = stepSec > 0 ? config.maxRetentionTimeSec / stepSec : 0

    const stepInterval = totalStep > 0 ? (endStep - startStep) / totalFrame : 0
    let stepList: number[]
    if (stepInterval > 0 && Number.isFinite(stepInterval)) {
      stepList = range(startStep, endStep, stepInterval)
      if (stepList.length === 0) {
        stepList.push(endStep)
      }
      else if (stepList.at(-1) !== endStep) {
        stepList.push(endStep)
      }
    }
    else {
      stepList = Array.from({ length: totalFrame }, () => startStep)
    }
    console.time('fillRank')
    const result = DataProcessor.fillRank(stepList, samplers, baselineScale, transitionSteps, carrySteps, config)
    console.timeEnd('fillRank')
    DataProcessor.addTailingFrames(config, result)
    return result
  }

  private static fillRank(
    stepList: number[],
    samplers: Sampler[],
    baselineScale: BaselineFn,
    transitionSteps: number,
    carrySteps: number,
    config: Config,
  ): RankedData[][] {
    return stepList.map((step) => {
      const baseline = baselineScale(step)
      const list: RankedData[] = []
      for (const sampler of samplers) {
        const sampled = DataProcessor.sampleAtStep(sampler, step, baseline, transitionSteps, carrySteps)
        list.push({
          id: sampler.id,
          label: sampler.label,
          value: sampled.value,
          step,
          alpha: sampled.alpha,
          raw: sampled.raw,
          up: false,
          rank: 0,
          blurRank: 0,
        })
      }
      // 按 value desc 排序：value=baseline 的 bar 自然落到尾部。NaN 兜底 → -Infinity。
      list.sort((a, b) => {
        const av = Number.isFinite(a.value) ? a.value : Number.NEGATIVE_INFINITY
        const bv = Number.isFinite(b.value) ? b.value : Number.NEGATIVE_INFINITY
        return bv - av
      })
      // rank: 在 topN 内严格按 value-sort（0..topN-1, unique）；超出 topN 的 bar 统一停在 rank=topN
      // （画面外一格的停车位）。alpha 由 applyVelocity 按 in-topN 状态推导。
      return list.map((d, i) => {
        d.rank = i < config.topN ? i : config.topN
        d.blurRank = d.rank
        return d
      })
    })
  }

  // 按 maxRetentionTimeSec 将每个 id 的真实数据点（已剔除 NaN）切成 segments。
  // 同段内 gap 在 sample 时用 easeInOutCubic 桥接；段间视为「先消失再出现」。
  private static buildSamplers(data: Data[], config: Config, stepSec: number): Sampler[] {
    const maxGapSteps = stepSec > 0 ? config.maxRetentionTimeSec / stepSec : Number.POSITIVE_INFINITY
    const idGroups = group(data, d => d.id)
    const samplers: Sampler[] = []
    for (const [id, groupData] of idGroups.entries()) {
      const real = groupData
        .filter(d => d.alpha > 0 && Number.isFinite(d.value))
        .toSorted((a, b) => a.step - b.step)
      if (real.length === 0) {
        continue
      }
      const label = real[0].label
      const segments: Segment[] = []
      let cur: Data[] = [real[0]]
      for (let i = 1; i < real.length; i++) {
        const prev = cur.at(-1)!
        const next = real[i]
        if ((next.step - prev.step) > maxGapSteps) {
          segments.push({
            firstStep: cur[0].step,
            lastStep: cur.at(-1)!.step,
            points: cur,
          })
          cur = [next]
        }
        else {
          cur.push(next)
        }
      }
      segments.push({
        firstStep: cur[0].step,
        lastStep: cur.at(-1)!.step,
        points: cur,
      })
      samplers.push({ id, label, segments })
    }
    return samplers
  }

  // 每个真实 step 上按 valueScaleType 计算 X 轴显示最小值，作为 enter/exit ramp 的起点/终点。
  //   from-zero  → 0
  //   from-min   → 2·dataMin − dataMax（topN 范围内）
  //   from-delta → dataMax − valueScaleDelta
  // 跟 BarChart 的 getValueScale 计算同步，保证新 bar 从「轴底」浮起，旧 bar 沉到「轴底」消失。
  private static buildBaselineScale(data: Data[], config: Config): BaselineFn {
    const real = data.filter(d => d.alpha > 0 && Number.isFinite(d.value))
    if (real.length === 0) {
      return () => 0
    }
    const stepGroups = group(real, d => d.step)
    const steps: number[] = []
    const baselines: number[] = []
    const sortedKeys = [...stepGroups.keys()].sort((a, b) => a - b)
    for (const step of sortedKeys) {
      const arr = [...stepGroups.get(step)!].sort((a, b) => b.value - a.value)
      const topNArr = arr.slice(0, config.topN)
      const dataMax = topNArr[0]?.value ?? 0
      const dataMin = topNArr.at(-1)?.value ?? dataMax
      let axisMin: number
      switch (config.valueScaleType) {
        case 'from-zero':
          axisMin = 0
          break
        case 'from-min':
          axisMin = dataMin - (dataMax - dataMin)
          break
        case 'from-delta':
        default:
          axisMin = dataMax - config.valueScaleDelta
          break
      }
      steps.push(step)
      baselines.push(axisMin)
    }
    if (steps.length === 1) {
      const v = baselines[0]
      return () => v
    }
    const scale = scaleLinear<number>().domain(steps).range(baselines).clamp(true)
    return (step: number) => scale(step)
  }

  // 区间判定：
  //   [first, last]                        → inside: piecewise easing 插值，alpha=1
  //   (last, last + carry]                 → carry-forward: value=lastValue, alpha=1
  //   [first - trans, first)               → enter: value 从 baseline (axis min) 缓动到 firstValue, alpha 0→1
  //   (last + carry, last + carry + trans] → exit:  value 从 lastValue 缓动到 baseline (axis min), alpha 1→0
  //   其他（段外远离 / 段间长 gap）        → value=baseline, alpha=0
  //
  // baseline 由 buildBaselineScale 按 valueScaleType 算出当前帧的「显示最小值」，所以入场 bar 从轴底浮起，
  // 出场 bar 沉到轴底。rank 由排序按当前 sampled value 自然推导：value 小 → rank=parking → applyVelocity
  // 把它压在屏外；value 长大穿过 topN 末位后，target rank ∈ [0, topN)，visualRank 平滑跟随。
  // applyVelocity 的 alpha 用 min(sampleAlpha, parkingMask)：ramp 阶段跟随 sampleAlpha，parking 时强制 0。
  private static sampleAtStep(
    sampler: Sampler,
    step: number,
    baseline: number,
    transitionSteps: number,
    carrySteps: number = 0,
  ): SampleResult {
    const segments = sampler.segments
    for (const seg of segments) {
      if (step >= seg.firstStep && step <= seg.lastStep + carrySteps) {
        const inSegment = step <= seg.lastStep
        const value = inSegment
          ? DataProcessor.interpolateInSegment(seg, step)
          : seg.points.at(-1)!.value
        return {
          value,
          alpha: 1,
          raw: DataProcessor.rawNearStep(seg, step),
        }
      }
    }
    if (transitionSteps > 0) {
      for (const seg of segments) {
        if (step >= seg.firstStep - transitionSteps && step < seg.firstStep) {
          const t = (step - (seg.firstStep - transitionSteps)) / transitionSteps
          const eased = easeInOutCubic(t)
          const target = seg.points[0]
          return {
            value: lerp(baseline, target.value, eased),
            alpha: eased,
            raw: { ...target.raw },
          }
        }
      }
      for (const seg of segments) {
        const exitStart = seg.lastStep + carrySteps
        if (step > exitStart && step <= exitStart + transitionSteps) {
          const t = (step - exitStart) / transitionSteps
          const eased = easeInOutCubic(t)
          const source = seg.points.at(-1)!
          return {
            value: lerp(source.value, baseline, eased),
            alpha: 1 - eased,
            raw: { ...source.raw },
          }
        }
      }
    }
    return {
      value: baseline,
      alpha: 0,
      raw: DataProcessor.nearestRaw(segments, step),
    }
  }

  private static interpolateInSegment(seg: Segment, step: number): number {
    const pts = seg.points
    if (pts.length === 1) {
      return pts[0].value
    }
    let lo = 0
    let hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].step <= step) {
        lo = mid
      }
      else {
        hi = mid
      }
    }
    const a = pts[lo]
    const b = pts[hi]
    if (a.step === b.step) {
      return a.value
    }
    const t = (step - a.step) / (b.step - a.step)
    return lerp(a.value, b.value, easeInOutCubic(t))
  }

  private static rawNearStep(seg: Segment, step: number): any {
    const pts = seg.points
    if (pts.length === 1) {
      return { ...pts[0].raw }
    }
    let lo = 0
    let hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].step <= step) {
        lo = mid
      }
      else {
        hi = mid
      }
    }
    const a = pts[lo]
    const b = pts[hi]
    if (a.step === b.step) {
      return { ...a.raw }
    }
    const t = (step - a.step) / (b.step - a.step)
    return { ...(t > 0.5 ? b.raw : a.raw) }
  }

  private static nearestRaw(segments: Segment[], step: number): any {
    if (segments.length === 0) {
      return null
    }
    const first = segments[0]
    if (step <= first.firstStep) {
      return { ...first.points[0].raw }
    }
    const last = segments.at(-1)!
    if (step >= last.lastStep) {
      return { ...last.points.at(-1)!.raw }
    }
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]
      const next = segments[i]
      if (step > prev.lastStep && step < next.firstStep) {
        const mid = (prev.lastStep + next.firstStep) / 2
        return { ...(step < mid ? prev.points.at(-1)!.raw : next.points[0].raw) }
      }
    }
    return null
  }

  private static addTailingFrames(config: Config, result: RankedData[][]) {
    // 尾帧：保留足够多帧让最后一段 velocity-driven 位移收敛。多 rank 跳跃时间 ≈ swapDurationSec × Δrank/2，
    // 取 max(2s, 4×swapDurationSec) 作为保守上界（一般 4 rank 内收敛足够）。
    const tailSec = Math.max(2, config.swapDurationSec * 4)
    const swapFrames = Math.max(1, Math.round(tailSec * config.fps))
    for (let i = 0; i < swapFrames; i++) {
      const lastFrame = result.at(-1)
      if (!lastFrame) {
        break
      }
      result.push(lastFrame.map(d => ({ ...d })))
    }
    const algo = SWAP_ALGORITHMS[config.swapAlgorithm]
    algo(config, result)
    DataProcessor.computeUpFlags(result)
  }

  // velocity-controlled rank trajectory + clamped target + boundary-driven alpha：
  //   target = d.rank（来自 fillRank，clamped 到 topN：内部 unique 0..topN-1，外部统一 topN 停车位）
  //   desired = sign(dist) × max(minVel, √(2·maxAccel·|dist|))（三角速度曲线，无 maxVel cap）
  //   velocity 以 maxAccel·dt 上限平滑变化；displacement = velocity × dt
  //   alpha = clamp(topN - blurRank, 0, 1)
  //     blurRank ≤ topN-1（in-topN）→ alpha=1
  //     blurRank = topN（parking）→ alpha=0
  //     boundary 过渡 blurRank ∈ (topN-1, topN) → alpha 跟随线性插值，与位置 ease 同步
  // 通过 SWAP_ALGORITHMS 派发，不要直接调用。
  static applyVelocity(config: Config, result: RankedData[][]) {
    const T = result.length
    if (T === 0) {
      return
    }
    if (result[0].length === 0) {
      return
    }

    const fps = config.fps
    const dt = 1 / fps
    const D = Math.max(1e-6, config.swapDurationSec)
    const maxAccel = 32 / (D * D)
    const minVel = 2 / D
    const maxDv = maxAccel * dt
    const topN = config.topN

    const visualRank = new Map<string, number>()
    const velocity = new Map<string, number>()

    // alpha = min(sampleAlpha, parkingMask)
    //   sampleAlpha 由 sampleAtStep 给出，跟随 enter/exit ramp 的 0↔1 渐变；
    //   parkingMask = clamp(topN - blurRank, 0, 1)，把 parking 槽 (visualRank≥topN) 的 bar 强制压成透明。
    // 入参 d.alpha 已经是 sampleAlpha（fillRank 写入），原地取 min 即可。
    const writeAlpha = (d: RankedData) => {
      const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
      d.alpha = Math.min(d.alpha, parkingMask)
    }

    // 第 0 帧：snap 到 clamped rank（外部直接坐落在 parking）。
    for (const d of result[0]) {
      visualRank.set(d.id, d.rank)
      velocity.set(d.id, 0)
      d.blurRank = d.rank
      writeAlpha(d)
    }

    for (let t = 1; t < T; t++) {
      const frame = result[t]
      for (const d of frame) {
        // 中途出现的新 id：直接落在 target，速度 0。
        if (!visualRank.has(d.id)) {
          visualRank.set(d.id, d.rank)
          velocity.set(d.id, 0)
          d.blurRank = d.rank
          writeAlpha(d)
          continue
        }

        const vrPrev = visualRank.get(d.id)!
        let v = velocity.get(d.id)!
        const target = d.rank
        const distance = target - vrPrev
        const absDist = Math.abs(distance)

        // 三角速度曲线 + minVel 兜底。
        let desired: number
        if (absDist < 1e-9) {
          desired = 0
        }
        else {
          const brakingVel = Math.sqrt(2 * maxAccel * absDist)
          const sign = distance >= 0 ? 1 : -1
          desired = sign * Math.max(minVel, brakingVel)
        }

        const dv = desired - v
        v += dv >= 0 ? Math.min(dv, maxDv) : Math.max(dv, -maxDv)

        let vr = vrPrev + v * dt
        if ((distance > 0 && vr > target) || (distance < 0 && vr < target)) {
          vr = target
          v = 0
        }
        if (Math.abs(target - vr) < 1e-4 && Math.abs(v) < minVel) {
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

  // up 状态用 blurRank 帧间变化判定。仅在接近整数 rank 时更新，避免过渡中翻转。
  private static computeUpFlags(result: RankedData[][]) {
    const byID = group(result.flat(), d => d.id)
    for (const records of byID.values()) {
      records.sort((a, b) => a.step - b.step)
      for (let i = 1; i < records.length; i++) {
        const cur = records[i].blurRank
        const prev = records[i - 1].blurRank
        const isNearInteger = Math.abs(cur - Math.round(cur)) < 0.05
        records[i].up = isNearInteger ? cur < prev : (records[i - 1]?.up ?? false)
      }
    }
  }

  private static preprocess(rawData: DSVRowArray<string>, config: Config) {
    const temp = rawData.map<Data>((d, i) => {
      const rawValue = config.getValue(d, i)
      const isMissing = Number.isNaN(rawValue)
      const result: Data = {
        id: config.getID(d, i),
        label: config.getLabel(d, i),
        value: isMissing ? 0 : rawValue,
        step: config.getStep(d, i),
        alpha: isMissing ? 0 : 1,
        raw: d,
        up: false,
      }
      for (const key in d) {
        const rawValue = d[key]
        if (key === config.labelField) {
          result[key] = rawValue
          continue
        }
        if (rawValue === result.id) {
          continue
        }
        const numericValue = Number(rawValue)
        if (!Number.isNaN(numericValue)) {
          result[key] = numericValue as any
        }
      }
      return result
    })
    const topN = config.topN
    const stepGroup = group(temp, d => Math.floor(d.step))
    const idSet = new InternSet<string>()
    for (const group of stepGroup.values()) {
      group.sort((a, b) => b.value - a.value)
      for (const d of group.slice(0, topN + 1)) idSet.add(d.id)
    }
    const idGroups = group(temp, d => d.id)
    const data = [...idGroups.values()].filter(group => idSet.has(group[0].id)).flat()
    return data
  }
}

// Strategy 注册表：新增算法只需 union 加 name + 这里注册即可。
const SWAP_ALGORITHMS: Record<SwapAlgorithmName, SwapAlgorithm> = {
  velocity: DataProcessor.applyVelocity,
}
