import type { DSVRowArray } from 'd3'
import type { Config, SwapAlgorithmName } from './Config'
import type { Data, RankedData } from './Data'
import { blur, csv, extent, group, InternSet, range, scaleLinear } from 'd3'
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
  // 入场 ramp 阶段标记：runVelocity 在未满榜时让这根柱就地从簇底淡入长出，而非穿越屏外底边淡变带。
  entering?: boolean
}

type BaselineFn = (step: number) => number

// 距离自适应加速度的半饱和距离：|dist| 比目标多这么多名次时，额外加速度达到上限增量的一半。
const ACCEL_DIST_HALF = 2

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// 二分定位：返回夹住 step 的两个相邻数据点 [a, b]（pts 按 step 升序）。单点段两者相同。
// interpolateInSegment（取插值 value）与 rawNearStep（取就近 raw）共用，消除两处重复的二分括定。
function locateBracket(pts: Data[], step: number): readonly [Data, Data] {
  if (pts.length === 1) {
    return [pts[0], pts[0]]
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
  return [pts[lo], pts[hi]]
}

// assignZOrder 排序键比较：返回 >0 表示 a 应在 b 之上（更大 zIndex / 盖住 b）。前瞻 blurRank 小
// （将上浮到更上方）者在上；前瞻相等再按当前 blurRank、id 兜底，保证全序稳定、无环。
function compareZOrder(a: string, b: string, futureBlur: Map<string, number>, curBlur: Map<string, number>): number {
  const fa = futureBlur.get(a)!
  const fb = futureBlur.get(b)!
  if (fa !== fb) {
    return fb - fa
  }
  const ca = curBlur.get(a)!
  const cb = curBlur.get(b)!
  if (ca !== cb) {
    return cb - ca
  }
  return a < b ? 1 : (a > b ? -1 : 0)
}

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
    // z-order 必须在 swap 算法（addTailingFrames 内）定下 blurRank 之后算，它消费逐帧（及前瞻）blurRank。
    DataProcessor.assignZOrder(config, result)
    return result
  }

  // 离线预计算渲染层级（写入 RankedData.zIndex，越大越上层 / 越靠前盖住别人）：前瞻定序 + 重叠冻结。
  //   排序键 = 「前瞻 blurRank」（未来 lead 帧 ≈ 半个 1-rank 行程的位置）：未来排名更靠上（正在上浮、
  //   即将盖过别人）的柱给更高层级。但相对顺序只允许在两柱「当前不重叠」时改变 —— 一旦垂直重叠
  //   （|ΔblurRank| < 1）就锁定其相对 z 直到重新分开。两者合起来：
  //     · 前瞻在「进入重叠之前」就把上浮者排到上层（解决纯瞬时速度「速度差等到重叠才拉开、上浮者反被锁下层」的时机问题）；
  //     · 重叠冻结保证重叠期相对 z 不逆变（不会两柱挨着却层级来回翻 / 闪烁）。
  //   冒泡每次只交换一对相邻元素，单次交换仅改变「被交换的那一对」的相对顺序；而交换前提是二者不重叠，
  //   故任意一对的相对 z 只可能在它们不重叠时改变 → 重叠期间严格不逆变（含 A-B、B-C 重叠的链式重叠簇，整簇锁定）。
  //
  // 为什么放离线预计算而非 BarChart.update：键依赖未来帧 blurRank、且顺序逐帧从上一帧继承（有状态），
  //   按帧序跑一次即可固化进 RankedData，update(frame) 仍只读不算、是 frame 的纯函数 —— Remotion 并发分块
  //   跳任意帧、进度条 scrub 都得到同一层叠，不在 chunk 接缝处闪跳。
  private static assignZOrder(config: Config, result: RankedData[][]) {
    const T = result.length
    if (T === 0 || result[0].length === 0) {
      return
    }
    // 前瞻帧数：约一个完整 1-rank 行程（1-rank 实际耗时 ≈ 0.35·swapDurationSec）。要取整行程而非半行程：
    // 重叠冻结要求在「进入重叠之前的最后一个不重叠帧」就排定顺序，故前瞻必须够远、越过交叉点看到换位
    // 完成后谁在上方（半行程的前瞻只到交叉点、两柱位置相等，分不出上浮者，会把它锁在下层）。
    const lead = Math.max(1, Math.round(0.35 * Math.max(1e-6, config.swapDurationSec) * config.fps))
    const futureBlur = new Map<string, number>()
    const curBlur = new Map<string, number>()
    const order: string[] = [] // 下层→上层（index 即 zIndex），逐帧从上一帧继承以实现重叠冻结

    for (let t = 0; t < T; t++) {
      const frame = result[t]
      const future = result[Math.min(T - 1, t + lead)]
      futureBlur.clear()
      for (const d of future) {
        futureBlur.set(d.id, d.blurRank)
      }
      curBlur.clear()
      for (const d of frame) {
        curBlur.set(d.id, d.blurRank)
        // 前瞻帧可能缺该 id（理论上每帧全量、不会发生），回退到当前 blurRank。
        if (!futureBlur.has(d.id)) {
          futureBlur.set(d.id, d.blurRank)
        }
      }
      // 同步 order 与当帧 id 集合：每帧本是全量 sampler（集合恒定），仍做增删以防御非全量情形。
      if (order.length === 0) {
        for (const d of frame) {
          order.push(d.id)
        }
      }
      else {
        const present = new Set<string>()
        for (const d of frame) {
          present.add(d.id)
        }
        const known = new Set(order)
        let w = 0
        for (const id of order) {
          if (present.has(id)) {
            order[w] = id
            w++
          }
        }
        order.length = w
        for (const d of frame) {
          if (!known.has(d.id)) {
            order.push(d.id)
          }
        }
      }
      if (t === 0) {
        // 首帧无「重叠不逆变」约束（没有上一帧可继承）：直接按前瞻键全排序定下初始层叠。
        order.sort((a, b) => compareZOrder(a, b, futureBlur, curBlur))
      }
      else {
        // 冻结冒泡：只交换「当前不重叠」的相邻逆序对（前瞻键判逆序），重叠相邻对保持顺序 → 重叠期不逆变。
        let swapped = true
        while (swapped) {
          swapped = false
          for (let i = 0; i < order.length - 1; i++) {
            const lower = order[i]
            const upper = order[i + 1]
            const overlap = Math.abs(curBlur.get(lower)! - curBlur.get(upper)!) < 1
            if (!overlap && compareZOrder(lower, upper, futureBlur, curBlur) > 0) {
              order[i] = upper
              order[i + 1] = lower
              swapped = true
            }
          }
        }
      }
      const byId = new Map<string, RankedData>()
      for (const d of frame) {
        byId.set(d.id, d)
      }
      for (const [i, id] of order.entries()) {
        const d = byId.get(id)
        if (d) {
          d.zIndex = i
        }
      }
    }
  }

  private static fillRank(
    stepList: number[],
    samplers: Sampler[],
    baselineScale: BaselineFn,
    transitionSteps: number,
    carrySteps: number,
    config: Config,
  ): RankedData[][] {
    const T = stepList.length
    const N = samplers.length
    const baselines = stepList.map(step => baselineScale(step))

    // 第一遍：逐 sampler 采样出整条 value/alpha/raw 序列（按列存），并对每个连续可见段做横向时间平滑。
    // 平滑必须在排序定 rank 之前：value（→ width）和 rank 都从同一条平滑序列派生，否则会出现
    // 「柱长被平滑、rank 仍按锯齿原值」的新逆序。围棋逐局赢跌的锯齿正是「刚出现条目左右抽搐」的根因。
    const valueCols: Float64Array[] = []
    const alphaCols: Float64Array[] = []
    const rawCols: any[][] = []
    // 入场标记：该帧该 bar 是否处于 enter ramp。runVelocity 在未满榜时据此让它就地淡入（不靠穿越底边带）。
    const enterCols: Uint8Array[] = []
    const radius = config.valueSmoothingRadius
    for (const sampler of samplers) {
      const values = new Float64Array(T)
      const alphas = new Float64Array(T)
      const raws: any[] = Array.from({ length: T })
      const entering = new Uint8Array(T)
      for (let t = 0; t < T; t++) {
        const sampled = DataProcessor.sampleAtStep(sampler, stepList[t], baselines[t], transitionSteps, carrySteps)
        values[t] = sampled.value
        alphas[t] = sampled.alpha
        raws[t] = sampled.raw
        entering[t] = sampled.entering ? 1 : 0
      }
      if (radius > 0) {
        DataProcessor.smoothVisibleSegments(values, alphas, radius)
      }
      valueCols.push(values)
      alphaCols.push(alphas)
      rawCols.push(raws)
      enterCols.push(entering)
    }

    // 第二遍：逐帧组装 → 按 value desc 排序 → 定 rank。
    const result: RankedData[][] = []
    const topN = config.topN
    for (let t = 0; t < T; t++) {
      const list: RankedData[] = []
      for (let si = 0; si < N; si++) {
        list.push({
          id: samplers[si].id,
          label: samplers[si].label,
          value: valueCols[si][t],
          step: stepList[t],
          alpha: alphaCols[si][t],
          raw: rawCols[si][t],
          rank: 0,
          blurRank: 0,
          // 入场标记透传给 runVelocity：未满榜入场柱就地淡入（renderAlpha 走 ramp）而非穿底边带。
          entering: enterCols[si][t] === 1,
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
      // 只在 alpha>0（可见/入场中）的条目之间按 value 定 rank 0..；alpha≤0 的未入场/已出场条目
      // 一律停在 topN 停车位（画面外底部一格），且不占可见排序位次。否则当条目少时，value≈baseline
      // 的大量填充条目会把正在入场的柱挤过 topN 边界，rank 在可见区↔停车位间跳变，blurRank 被甩成
      // 「先下后上」，渐显途中还露出 width≈0 的「只有数字没有柱子」。隔离后入场只会从底部纯上浮。
      let visibleIdx = 0
      for (const d of list) {
        d.rank = d.alpha > 0 ? Math.min(visibleIdx++, topN) : topN
        d.blurRank = d.rank
      }
      result.push(list)
    }
    return result
  }

  // 对单个 sampler 的逐帧 value 序列做分段 zero-phase 平滑：仅在连续可见段（alpha>0）内，
  // 用 d3.blur（三次 box 近似高斯、零相位、不引入延迟）削掉数据逐点锯齿。段间（alpha=0、
  // value=baseline）隔离，避免把 baseline 拖进可见区污染入场/出场 ramp。段长 < 3 跳过。
  private static smoothVisibleSegments(values: Float64Array, alphas: Float64Array, radius: number): void {
    const T = values.length
    let start = -1
    const flush = (end: number) => {
      if (start >= 0 && end - start >= 3) {
        // subarray 与 values 共享 buffer，blur 原地修改即写回原序列。
        blur(values.subarray(start, end), radius)
      }
      start = -1
    }
    for (let t = 0; t < T; t++) {
      if (alphas[t] > 0) {
        if (start < 0) {
          start = t
        }
      }
      else {
        flush(t)
      }
    }
    flush(T)
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
  //   [first, last]                        → inside: 点间线性插值（匀速、无顿挫），alpha=1
  //   (last, last + carry]                 → carry-forward: value=lastValue, alpha=1
  //   [first - trans, first)               → enter: value 从 baseline (axis min) 缓动到 firstValue, alpha 0→1
  //   (last + carry, last + carry + trans] → exit:  value 从 lastValue 缓动到 baseline (axis min), alpha 1→0
  //   其他（段外远离 / 段间长 gap）        → value=baseline, alpha=0
  //
  // baseline 由 buildBaselineScale 按 valueScaleType 算出当前帧的「显示最小值」，所以入场 bar 从轴底浮起，
  // 出场 bar 沉到轴底。rank 始终由排序按当前 sampled value 自然推导：入场柱 value 从 baseline 爬升，先排在
  // 可见簇末位（簇底），value 长大才上升——绝不凭空插到中间挤开他人。满榜时 value 小 → rank=parking →
  // applyVelocity 把它压在屏外底边、自下浮起；未满榜时 runVelocity 直接 snap 到簇底、就地从 width≈0 淡入长出
  // （entering 标记驱动 renderAlpha 走 ramp，不靠穿越底边带）。
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
            raw: target.raw,
            entering: true,
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
            raw: source.raw,
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
    const [a, b] = locateBracket(seg.points, step)
    if (a.step === b.step) {
      return a.value
    }
    const t = (step - a.step) / (b.step - a.step)
    // 点间线性插值（匀速）。曾用 easeInOutCubic，但它在每个数据点处把速度降到 0，
    // 形成「加速→停顿→加速」的顿挫：稀疏数据（如 GDP 年度点）每个点一抖，密集数据
    // （如围棋逐局评分）则高频抽搐。线性插值速度恒定、点处不停顿，运动连续平滑。
    return lerp(a.value, b.value, t)
  }

  // raw 一律按引用返回（不再 spread 克隆）：下游（getColor/getBarInfo/getValueLabel/取图）全是只读，
  // 全仓无对 d.raw 的写入。此前每个可见 bar 每帧都克隆一份内容相同的 raw，是 O(帧×bar) 的纯分配浪费。
  private static rawNearStep(seg: Segment, step: number): any {
    const [a, b] = locateBracket(seg.points, step)
    if (a.step === b.step) {
      return a.raw
    }
    const t = (step - a.step) / (b.step - a.step)
    return t > 0.5 ? b.raw : a.raw
  }

  private static nearestRaw(segments: Segment[], step: number): any {
    if (segments.length === 0) {
      return null
    }
    const first = segments[0]
    if (step <= first.firstStep) {
      return first.points[0].raw
    }
    const last = segments.at(-1)!
    if (step >= last.lastStep) {
      return last.points.at(-1)!.raw
    }
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]
      const next = segments[i]
      if (step > prev.lastStep && step < next.firstStep) {
        const mid = (prev.lastStep + next.firstStep) / 2
        return step < mid ? prev.points.at(-1)!.raw : next.points[0].raw
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
  // 距离自适应加速度（boost 参数，软饱和）：
  //   aEff = maxAccel·(1 + boost·(1 − 2^(−max(0,|dist|−1)/ACCEL_DIST_HALF)))。
  //   随 |dist| 平滑上升、渐近到上限 maxAccel·(1+boost)，导数连续、无硬截止——避免暴涨柱跨多名次时
  //   加速度线性爆炸盖过惯性（boost 由「线性斜率」变为「额外加速度的上限倍数」）。
  //   boost=0 → aEff≡maxAccel，纯反馈速度模型（applyVelocity）；
  //   boost>0 → |dist|>1 时加速度增大、压缩 blurRank 滞后 value-rank 的逆序时间（applyVelocityAccel）；
  //     |dist|≤1 的普通 1-rank 交换 aEff 不变 → 惯性观感与 velocity 完全一致。
  //   刻意不引入 softRank/前馈：前馈的 d(softRank)/dt 含 ε 抖动噪声，被 /dt 放大后会推动「无关柱」原地
  //     上下抽搐（实测方向反转数 20×），故弃用——boost 单独即可压逆序且零抽搐、运动全程平滑。
  //
  // lookahead（preview control，相位前移）：管线离线预计算、未来 rank 已知，target 取 t+L 帧的 rank
  //   而非当帧。L ≈ 半个 1-rank 行程（Config 派生），使 blurRank 交叉恰好对中数据交叉点——
  //   纯因果反馈的滞后型逆序（动画总在数据之后才交叉）被相位前移直接抵消，逆序时间 −60%~−90%，
  //   而速度/加速度塑形一字未动（smoothnessEnergy / directionReversals 与无 lookahead 完全一致）。
  //
  // 底边淡变带限速（艺术减速，非对称）：blurRank ∈ (topN−1, topN) 即 alpha 渐变带内，
  //   退场（v>0）限速 1/exitFadeSec、入场（v<0）限速 1/enterFadeSec —— 快速穿带的「闪现/闪退」
  //   被拉长成至少 fade 秒的淡入淡出。入场限速会拖慢高 value 柱（= 新增逆序），因此入场柱的
  //   lookahead 额外加 swapEnterExtraFrames：更早动身、慢速浮起、到位时间不变，逆序代价 ≈ 0。
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
    const lookahead = config.swapLookaheadFrames
    const enterLookahead = lookahead + (config.swapEnterFadeSec > 0 ? config.swapEnterExtraFrames : 0)
    const useLookahead = enterLookahead > 0
    const exitMaxVel = config.swapExitFadeSec > 0 ? 1 / config.swapExitFadeSec : Number.POSITIVE_INFINITY
    const enterMaxVel = config.swapEnterFadeSec > 0 ? 1 / config.swapEnterFadeSec : Number.POSITIVE_INFINITY

    // 未来帧 id→rank 的滑动窗口缓存：帧 f 只在 t ∈ [f−enterLookahead, f−lookahead] 期间被查询，
    // 之后即可淘汰 —— 存活映射 ≤ (enterLookahead − lookahead + 2) 个，避免 O(N×T) 的整表驻留。
    const futureRankCache = new Map<number, Map<string, number>>()
    const futureRank = (frameIdx: number, id: string, fallback: number): number => {
      const f = Math.min(T - 1, frameIdx)
      let m = futureRankCache.get(f)
      if (!m) {
        m = new Map()
        for (const item of result[f]) {
          m.set(item.id, item.rank)
        }
        futureRankCache.set(f, m)
      }
      return m.get(id) ?? fallback
    }

    const visualRank = new Map<string, number>()
    const velocity = new Map<string, number>()

    // alpha = min(sampleAlpha, parkingMask)：sampleAlpha（入参 d.alpha）跟随 enter/exit ramp 的 0↔1；
    // parkingMask = clamp(topN - blurRank, 0, 1) 把 parking 槽 (blurRank≥topN) 压成透明。
    // renderAlpha（柱体最终不透明度，BarChart 直接取用）：未满榜入场柱就地淡入 → 跟随 ramp 后的 d.alpha；
    // 其余维持「只由纵向位置决定」的 parkingMask（满榜入场穿越底边带淡入、常驻柱恒 1），与原渲染逐帧一致。
    const writeAlpha = (d: RankedData, notFull: boolean) => {
      const parkingMask = Math.max(0, Math.min(1, topN - d.blurRank))
      d.alpha = Math.min(d.alpha, parkingMask)
      d.renderAlpha = notFull && d.entering ? d.alpha : parkingMask
    }
    const countNotFull = (frame: RankedData[]): boolean => {
      let visibleCount = 0
      for (const d of frame) {
        if (d.alpha > 0) {
          visibleCount++
        }
      }
      return visibleCount <= topN
    }

    // 第 0 帧、以及中途首次出现的新 id：直接 snap 到 rank，速度 0。
    const seed = (d: RankedData, notFull: boolean) => {
      visualRank.set(d.id, d.rank)
      velocity.set(d.id, 0)
      d.blurRank = d.rank
      writeAlpha(d, notFull)
    }
    const notFull0 = countNotFull(result[0])
    for (const d of result[0]) {
      seed(d, notFull0)
    }

    for (let t = 1; t < T; t++) {
      // 未满榜（可见条目 ≤ topN）：入场柱（上一帧还停在屏外停车位 vrPrev≈topN、本帧刚按 value 排进可见簇底）
      // 直接 snap 到簇底名次 —— 就地从 width≈0 淡入长出，不再自屏外底部一路上滑。snap 发生时 ramp≈0、
      // renderAlpha≈0，所以这一跳不可见；之后按 value 自然爬升（不挤开他人）。满榜时不 snap，维持自停车位浮起。
      const notFull = countNotFull(result[t])
      for (const d of result[t]) {
        if (!visualRank.has(d.id)) {
          seed(d, notFull)
          continue
        }

        const vrPrev = visualRank.get(d.id)!
        if (notFull && vrPrev >= topN - 1e-6 && d.rank < topN) {
          visualRank.set(d.id, d.rank)
          velocity.set(d.id, 0)
          d.blurRank = d.rank
          writeAlpha(d, notFull)
          continue
        }
        // 在淡变带内或停车位（vrPrev > topN−1）的柱视为「入场中」，用更长的前移量补偿入场限速。
        // 但未满榜时不给停车位柱做提前上移：否则 lookahead 会在 ramp 开始前就把它从屏外拽出来，等真正入场时
        // vrPrev 已 < topN、下面的 snap 失效 → 退化回「自屏外底部长途上滑」。停在 topN 等 snap 接管才能就地出现。
        const parkedOrBand = vrPrev > topN - 1
        const lookaheadFrames = parkedOrBand ? (notFull ? 0 : enterLookahead) : lookahead
        const target = useLookahead
          ? futureRank(t + lookaheadFrames, d.id, d.rank)
          : d.rank
        const dist = target - vrPrev
        const absDist = Math.abs(dist)
        // 距离自适应加速度（软饱和）：随 |dist| 平滑上升、渐近到 maxAccel·(1+boost) 上限，不硬截止；
        // |dist|≤1 或 boost=0 时 aEff=maxAccel（普通 1-rank 交换 / 纯 velocity 不变）。
        const aEff = maxAccel * (1 + boost * (1 - 2 ** (-Math.max(0, absDist - 1) / ACCEL_DIST_HALF)))
        const maxDv = aEff * dt
        const desired = absDist < 1e-9
          ? 0
          : Math.sign(dist) * Math.max(minVel, Math.sqrt(2 * aEff * absDist))

        let v = velocity.get(d.id)!
        v += Math.max(-maxDv, Math.min(maxDv, desired - v))
        // 淡变带限速：只压「快于 fade 节奏」的穿带（慢速换位本就低于上限，不受影响）。
        if (vrPrev > topN - 1 && vrPrev < topN) {
          v = Math.max(-enterMaxVel, Math.min(v, exitMaxVel))
        }
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
        writeAlpha(d, notFull)
      }
      // 帧 t+lookahead 的最后使用者就是本轮 t，下一轮起只会查更靠后的帧 → 淘汰。
      // 末尾 clamp 到 T−1 的映射保留到结束。
      if (t + lookahead < T - 1) {
        futureRankCache.delete(t + lookahead)
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
