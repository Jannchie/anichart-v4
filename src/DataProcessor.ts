/* eslint-disable no-console */
import type { DSVRowArray, InternMap, ScaleLinear } from 'd3'
import type { Config } from './Config'
import type { Data, RankedData } from './Data'
import { blur, csv, extent, group, InternSet, interpolate, range, scaleLinear } from 'd3'

export class DataProcessor {
  static async processCSV(path: string, config: Config): Promise<RankedData[][]> {
    const rawData = await csv(path)
    return DataProcessor.processRows(rawData, config)
  }

  static processRows(rawData: DSVRowArray<string>, config: Config): RankedData[][] {
    console.time('process')
    const data = DataProcessor.preprocess(rawData, config)
    console.timeEnd('process')
    // group by time
    const rawStepList = [...new InternSet(data.map(d => d.step))]
    const idGroups = group(data, d => d.id)
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

    console.time('scaleMap')
    const scaleMap = DataProcessor.getScaleMap(idGroups, endStep, stepSec, config, startStep, transitionDurationSec)
    console.timeEnd('scaleMap')
    // start step end step, fps, stepSec,
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
    const result = DataProcessor.fillRank(stepList, scaleMap, config)
    console.timeEnd('fillRank')
    DataProcessor.addTailingFrames(config, result)
    return result
  }

  private static fillRank(stepList: number[], scaleMap: Map<string, ScaleLinear<Data, Data>>, config: Config) {
    return stepList.map((step) => {
      const list: RankedData[] = []
      for (const scale of scaleMap.values()) {
        const scaledData = scale(step)
        if (scaledData) {
          const cloned: RankedData = {
            ...scaledData,
            rank: 0,
            blurRank: 0,
          }
          list.push(cloned)
        }
      }
      // 根据 value 排序
      list.sort((a, b) => {
        const aValue = a.alpha <= 0 ? Number.NaN : a.value
        const bValue = b.alpha <= 0 ? Number.NaN : b.value
        // 如果是 NaN 则排在最后
        if (Number.isNaN(aValue)) {
          return 1
        }
        if (Number.isNaN(bValue)) {
          return -1
        }
        return bValue - aValue
      })
      // 多留一位
      return list.slice(0, config.topN + 1).map((d, i) => {
        d.rank = i // 填上排名
        if (d.blurRank === 0) {
          d.blurRank = i
        }
        return d
      })
    })
  }

  private static addTailingFrames(config: Config, result: RankedData[][]) {
    // swap 占用的帧数：
    const swapFrames = config.swapDurationSec * config.fps
    // 最后需要留出一次交换的时间，将最后一帧的数据复制 swapFrames 次
    for (let i = 0; i < swapFrames; i++) {
      // 为了避免引用问题，需要深拷贝
      const lastFrame = result.at(-1)
      if (!lastFrame) {
        break
      }
      result.push(lastFrame.map(d => ({ ...d })))
    }
    const groupIDResult = group(result.flat(), d => d.id)
    for (const records of groupIDResult.values()) {
      records.sort((a, b) => a.step - b.step)
      const ranks = records.map(d => d.rank)
      const swapFrames = config.swapDurationSec * config.fps
      const blurRanks = blur(ranks, swapFrames / 6)

      for (const [i, d] of records.entries()) {
        d.blurRank = blurRanks[i]
        // 如果 blur rank 在 TopN - 1 ~ TopN 之间，则需要调整 alpha
        // 如果 TopN 是 20，那么 blurRank 在 19 ~ 20 之间的 alpha 为 1 ~ 0，越靠近 20，alpha 越小
        if (d.blurRank >= config.topN - 1) {
          const alpha = 1 - (d.blurRank - config.topN + 1)
          d.alpha = Math.max(0, Math.min(1, alpha))
        }
        // 还需要检查是否是上升还是下降。
        // 只有当当前blurRank接近整数时才更新up状态，避免移动过程中的层叠跳跃
        if (i > 0) {
          const currentRank = blurRanks[i]
          const prevRank = blurRanks[i - 1]

          // 检查当前rank是否接近整数（允许小范围误差）
          const isNearInteger = Math.abs(currentRank - Math.round(currentRank)) < 0.001

          d.up = isNearInteger
            ? currentRank < prevRank // 只在接近整数位置时更新up状态
            : records[i - 1]?.up ?? false // 移动过程中保持前一帧的up状态
        }
      }
    }
  }

  private static preprocess(rawData: DSVRowArray<string>, config: Config) {
    const temp = rawData.map<Data>((d, i) => {
      const result: Data = {
        id: config.getID(d, i),
        label: config.getLabel(d, i),
        value: config.getValue(d, i),
        step: config.getStep(d, i),
        alpha: Number.isNaN(config.getValue(d)) ? 0 : 1,
        raw: d,
        up: false,
      }
      for (const key in d) {
        const rawValue = d[key]
        // Preserve the original label field to avoid unwanted number coercion
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
    // 获取进入了 TopN 的 id
    for (const group of stepGroup.values()) {
      group.sort((a, b) => b.value - a.value)
      for (const d of group.slice(0, topN + 1)) idSet.add(d.id) // 多留一位
    }
    const idGroups = group(temp, d => d.id)
    const data = [...idGroups.values()].filter(group => idSet.has(group[0].id)).flat()
    return data
  }

  private static getScaleMap(
    idGroups: InternMap<string, Data[]>,
    endStep: number,
    stepSec: number,
    config: Config,
    startStep: number,
    transitionDurationSec: number,
  ) {
    const scaleMap = new Map<string, ScaleLinear<Data, Data>>()
    const transitionSteps = transitionDurationSec / stepSec
    const retentionSteps = config.maxRetentionTimeSec / stepSec
    const decayRate = config.decayRate
    const decayValue = (value: number) => {
      if (Number.isNaN(decayRate)) {
        return Number.NaN
      }
      return value * decayRate
    }
    const createNode = (source: Data, overrides: Partial<Data>): Data => ({
      id: source.id,
      label: source.label,
      value: overrides.value ?? source.value,
      step: overrides.step ?? source.step,
      raw: overrides.raw ?? source.raw,
      alpha: overrides.alpha ?? source.alpha ?? 0,
      up: overrides.up ?? source.up ?? false,
      placeholder: overrides.placeholder ?? (source as any).placeholder ?? false,
      skipNaNBridge: overrides.skipNaNBridge ?? (source as any).skipNaNBridge ?? false,
    })

    for (const [key, originalGroup] of idGroups.entries()) {
      const sortedGroup = originalGroup.toSorted((a, b) => a.step - b.step)
      const last = sortedGroup.at(-1)
      if (!last) {
        continue
      }
      const baseSequence: Data[] = [...sortedGroup]
      if ((endStep - last.step) * stepSec > config.maxRetentionTimeSec) {
        baseSequence.push(
          createNode(last, {
            value: decayValue(last.value),
            step: last.step + transitionSteps, // 退出动画的终点
            alpha: 0,
            up: false,
            placeholder: true,
            skipNaNBridge: true,
          }),
          createNode(last, {
            value: Number.NaN,
            step: endStep, // 最后一个时间戳
            alpha: 0,
            up: false,
            placeholder: true,
            skipNaNBridge: false,
          }),
        )
      }
      let prevStep = startStep
      const expanded: Data[] = []
      for (let i = 0; i < baseSequence.length; i++) {
        const cur = baseSequence[i]
        const curStep = cur.step
        if ((curStep - prevStep) * stepSec > config.maxRetentionTimeSec) {
          expanded.push(
            createNode(cur, {
              value: decayValue(cur.value),
              step: prevStep + transitionSteps,
              alpha: 0,
              up: false,
              placeholder: true,
              skipNaNBridge: true,
            }),
            createNode(cur, {
              value: decayValue(cur.value),
              step: prevStep + retentionSteps,
              alpha: 0,
              up: false,
              placeholder: true,
              skipNaNBridge: true,
            }),
            createNode(cur, {
              value: decayValue(cur.value),
              step: curStep - transitionSteps,
              alpha: 0,
              up: true,
              placeholder: true,
              skipNaNBridge: true,
            }),
          )
        }
        // 如果 cur 的值是 NaN，则前后点需要加过渡元素
        if (Number.isNaN(cur.value) && !(cur as any).skipNaNBridge) {
          const prev = expanded.at(-1)
          if (prev) {
            expanded.push(createNode(prev, {
              value: decayValue(prev.value),
              step: prev.step + transitionSteps,
              alpha: 0,
              up: false,
              placeholder: true,
              skipNaNBridge: true,
            }))
          }
        }
        expanded.push(cur)
        if (Number.isNaN(cur.value) && !(cur as any).skipNaNBridge) {
          const next = baseSequence[i + 1]
          if (next && !Number.isNaN(next.value)) {
            expanded.push(createNode(next, {
              value: decayValue(next.value),
              step: next.step - transitionSteps,
              alpha: 0,
              up: true,
              placeholder: true,
              skipNaNBridge: true,
            }))
          }
        }
        prevStep = curStep
      }
      const scale = scaleLinear<Data>()
        .domain(expanded.map(d => d.step))
        .range(expanded)
        .clamp(true)
        .interpolate((a, b) => {
          const inter = interpolate(a, b)
          return (t) => {
            const res = inter(t)
            if (res) {
            // 使用更接近目标点的 raw 数据
              res.raw = t > 0.5 ? { ...b.raw } : { ...a.raw }
            }
            return res
          }
        })
      scaleMap.set(key, scale)
    }
    return scaleMap
  }
}
