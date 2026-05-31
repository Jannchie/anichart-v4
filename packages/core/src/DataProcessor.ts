import type { DSVRowArray } from 'd3'
import type { Config, SwapAlgorithmName } from './Config'
import type { Data, RankedData } from './Data'
import { csv, extent, group, InternSet, range, scaleLinear } from 'd3'
import { computeReferenceSpan } from './utils/chartChrome'
import { adaptiveDomainMin } from './utils/scale'

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

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export class DataProcessor {
  static async processCSV(path: string, config: Config): Promise<RankedData[][]> {
    const rawData = await csv(path)
    return DataProcessor.processRows(rawData, config)
  }

  static processRows(rawData: DSVRowArray<string>, config: Config): RankedData[][] {
    const data = DataProcessor.preprocess(rawData, config)
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
    // transitionDurationSec 受 maxRetentionTimeSec/2 上限约束：超出时静默 clamp（避免 fade 区间吞掉整个保留窗）。
    const transitionDurationSec = Math.min(config.transitionDurationSec, maxTransitionDuration)
    const transitionSteps = stepSec > 0 ? transitionDurationSec / stepSec : 0

    const samplers = DataProcessor.buildSamplers(data, config, stepSec)
    const baselineScale = DataProcessor.buildBaselineScale(data, config)

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
      stepList = Array.from<number>({ length: totalFrame }).fill(startStep)
    }
    const result = DataProcessor.fillRank(stepList, samplers, baselineScale, transitionSteps, carrySteps, config)
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
        d.rank = Math.min(i, config.topN)
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
  //   adaptive   → adaptiveDomainMin：最后一条相对长度随首尾差距软饱和（半衰尺度=span 中位数）
  // 跟 BarChart 的 getValueScale 计算同步，保证新 bar 从「轴底」浮起，旧 bar 沉到「轴底」消失。
  private static buildBaselineScale(data: Data[], config: Config): BaselineFn {
    const real = data.filter(d => d.alpha > 0 && Number.isFinite(d.value))
    if (real.length === 0) {
      return () => 0
    }
    const stepGroups = group(real, d => d.step)
    const sortedKeys = [...stepGroups.keys()].sort((a, b) => a - b)
    const rows = sortedKeys.map((step) => {
      const arr = [...stepGroups.get(step)!].sort((a, b) => b.value - a.value)
      const topNArr = arr.slice(0, config.topN)
      const dataMax = topNArr[0]?.value ?? 0
      const dataMin = topNArr.at(-1)?.value ?? dataMax
      return { step, dataMax, dataMin }
    })
    // adaptive 参考尺度：屏内首尾差距的中位数（与 BarChart.getValueScale 同步，保证入场/出场基线一致）。
    const referenceSpan = config.valueScaleType === 'adaptive'
      ? computeReferenceSpan(rows.map(r => r.dataMax - r.dataMin))
      : 0
    const steps: number[] = []
    const baselines: number[] = []
    for (const { step, dataMax, dataMin } of rows) {
      let axisMin: number
      switch (config.valueScaleType) {
        case 'from-zero': {
          axisMin = 0
          break
        }
        case 'from-min': {
          axisMin = dataMin - (dataMax - dataMin)
          break
        }
        case 'adaptive': {
          axisMin = adaptiveDomainMin(dataMin, dataMax, referenceSpan, config.valueScaleMinRatio, config.valueScaleMaxRatio)
          break
        }
        case 'from-delta':
        default: {
          axisMin = dataMax - config.valueScaleDelta
          break
        }
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
    const lastFrame = result.at(-1)
    if (lastFrame) {
      const tailSec = Math.max(2, config.swapDurationSec * 4)
      const swapFrames = Math.max(1, Math.round(tailSec * config.fps))
      for (let i = 0; i < swapFrames; i++) {
        result.push(lastFrame.map(d => ({ ...d })))
      }
    }
    // SWAP_ALGORITHMS 在文件末尾定义（其值引用本类静态方法，无法上移否则 TDZ）；此处运行期调用，const 已初始化。
    // eslint-disable-next-line ts/no-use-before-define
    const algo = SWAP_ALGORITHMS[config.swapAlgorithm]
    algo(config, result)
  }

  // velocity-controlled rank trajectory（"arrive" 减速曲线 + boundary-driven alpha）：
  //   target = d.rank（fillRank 给出：屏内 unique 0..topN-1，屏外统一 topN 停车位）。每根 bar 始终朝自己的
  //     真实 dataRank 移动——不做"身位让位 / 吸附 round(vrPrev)"修正：那样在身位内没有紧邻倒置对手时
  //     会把 bar 钉死在错误名次，y 位置与 value 名次脱节（这是被移除的旧 proximity 方案的核心缺陷）。
  //   desired = sign(dist) × max(minVel, √(2·aEff·|dist|))
  //     √(2·aEff·|dist|) 是"以 aEff 匀减速恰好停在 target"的速度：距离越大越快，所以暴涨 / 暴跌的 bar
  //     一次跨多名次也能全速追上，不会被固定速度上限拖成长期错位；minVel 兜住末段、保证 ~swapDurationSec 内及时到位
  //     （指数趋近 / 弹簧类模型缺这一项，会拖出长尾导致名次顺序迟迟不就位，实测错位帧数翻倍）。
  //   v 每帧最多变化 aEff·dt（限制 jerk），位移 = v·dt；越过 target 或贴住且低速 → 吸附整数（收敛 + 防漂移）。
  //   alpha = min(sampleAlpha, clamp(topN - blurRank, 0, 1))：blurRank≤topN-1 → 1；=topN → 0；boundary 线性过渡。
  //
  // 距离自适应加速度（boost 参数）：aEff = maxAccel·(1 + boost·max(0,|dist|−1))。
  //   boost=0 → aEff≡maxAccel，纯反馈速度模型（applyVelocity）；
  //   boost>0 → |dist|>1 时加速度变大、到达时间从线性压成次线性 → 压缩 blurRank 滞后 value-rank 的逆序时间
  //     （applyVelocityAccel）；|dist|≤1 的普通 1-rank 交换 aEff 不变 → 惯性观感与 velocity 完全一致。
  //   刻意不引入 softRank/前馈：前馈的 d(softRank)/dt 含 ε 抖动噪声，被 /dt 放大后会推动「无关柱」原地
  //     上下抽搐（实测方向反转数 20×），故弃用——boost 单独即可压逆序且零抽搐、运动全程平滑。
  private static runVelocity(config: Config, result: RankedData[][], boost: number) {
    const T = result.length
    if (T === 0 || result[0].length === 0) {
      return
    }

    const dt = 1 / config.fps
    const D = Math.max(1e-6, config.swapDurationSec)
    // maxAccel=32/D²、minVel=2/D 均随 1/D 缩放：改 swapDurationSec 即整体变速（越大越慢）。三角速度曲线无巡航封顶，
    // 1-rank 实际耗时 ≈ 0.35·D（非 D 本身）；D 是相对节奏标度而非绝对秒数。
    const maxAccel = 32 / (D * D)
    const minVel = 2 / D
    const topN = config.topN

    const visualRank = new Map<string, number>()
    const velocity = new Map<string, number>()

    // alpha = min(sampleAlpha, parkingMask)：sampleAlpha（入参 d.alpha）跟随 enter/exit ramp 的 0↔1；
    // parkingMask = clamp(topN - blurRank, 0, 1) 把 parking 槽 (blurRank≥topN) 压成透明。
    const writeAlpha = (d: RankedData) => {
      const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
      d.alpha = Math.min(d.alpha, parkingMask)
    }

    // 第 0 帧、以及中途首次出现的新 id：直接 snap 到 rank，速度 0。
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
        const target = d.rank
        const dist = target - vrPrev
        const absDist = Math.abs(dist)
        // 距离自适应加速度：dist 越大加速度越大，暴涨柱更快收敛；dist≤1 或 boost=0 时 aEff=maxAccel（不变）。
        const aEff = maxAccel * (1 + boost * Math.max(0, absDist - 1))
        const maxDv = aEff * dt
        const desired = absDist < 1e-9
          ? 0
          : Math.sign(dist) * Math.max(minVel, Math.sqrt(2 * aEff * absDist))

        let v = velocity.get(d.id)!
        v += Math.max(-maxDv, Math.min(maxDv, desired - v))
        let vr = vrPrev + v * dt

        // 越过 target，或已贴住且速度低于 minVel → 吸附整数停住（收敛 + 防漂移）。
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

  // 纯反馈速度模型：blurRank 用「匀减速恰好停在 target」追踪离散 target rank（boost=0）。
  // 通过 SWAP_ALGORITHMS 派发，不要直接调用。
  static applyVelocity(config: Config, result: RankedData[][]) {
    DataProcessor.runVelocity(config, result, 0)
  }

  // velocity + 距离自适应加速度：暴涨穿多级时加速度变大、更快收敛、压缩逆序时间，普通 1-rank 交换与
  // velocity 一致。swapAccelBoost=0 严格退化为 velocity。通过 SWAP_ALGORITHMS 派发，不要直接调用。
  static applyVelocityAccel(config: Config, result: RankedData[][]) {
    DataProcessor.runVelocity(config, result, config.swapAccelBoost)
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
      // 把数字样的额外列铺到 Data 上（label 列保留原字符串），方便自定义 accessor 直接读 d.<column>。
      for (const key in d) {
        const cellValue = d[key]
        if (key === config.labelField) {
          result[key] = cellValue
          continue
        }
        if (cellValue === result.id) {
          continue
        }
        const numericValue = Number(cellValue)
        if (!Number.isNaN(numericValue)) {
          result[key] = numericValue as any
        }
      }
      return result
    })
    const topN = config.topN
    const stepGroup = group(temp, d => Math.floor(d.step))
    const idSet = new InternSet<string>()
    for (const stepRows of stepGroup.values()) {
      stepRows.sort((a, b) => b.value - a.value)
      for (const d of stepRows.slice(0, topN + 1)) idSet.add(d.id)
    }
    const idGroups = group(temp, d => d.id)
    const data = [...idGroups.values()].filter(rows => idSet.has(rows[0].id)).flat()
    return data
  }
}

// Strategy 注册表：新增算法只需 union 加 name + 这里注册即可。
const SWAP_ALGORITHMS: Record<SwapAlgorithmName, SwapAlgorithm> = {
  'velocity': DataProcessor.applyVelocity,
  'velocity-accel': DataProcessor.applyVelocityAccel,
}
