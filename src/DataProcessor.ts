/* eslint-disable no-console */
import type { DSVRowArray, InternMap, ScaleLinear } from 'd3'
import { InternSet, blur, csv, extent, group, interpolate, range, scaleLinear } from 'd3'
import type { Data } from './Data'
import type { Config } from './Config'

export class DataProcessor {
  static async processCSV(path: string, config: Config): Promise<Data[][]> {
    const rawData = await csv(path)
    console.time('process')
    const data = DataProcessor.preprocess(rawData, config)
    console.timeEnd('process')
    // group by time
    const rawStepList = Array.from(new InternSet(data.map(d => d.step)))
    const idGroups = group(data, d => d.id)
    const [startStep, endStep] = extent(rawStepList)
    if (typeof startStep !== 'number' || typeof endStep !== 'number') {
      throw new TypeError('startStep and endStep must be number')
    }
    const totalStep = endStep - startStep
    const totalSec = config.totalDurationSec
    const stepSec = totalSec / totalStep
    if (config.transitionDurationSec * 2 > config.maxRetentionTimeSec) {
      config.transitionDurationSec = config.maxRetentionTimeSec / 2
      console.warn('transitionDurationSec * 2 > maxRetentionTimeSec, set transitionDurationSec to maxRetentionTimeSec / 2')
    }

    console.time('scaleMap')
    const scaleMap = DataProcessor.getScaleMap(idGroups, endStep, stepSec, config, startStep)
    console.timeEnd('scaleMap')
    // start step end step, fps, stepSec,
    const totalFrame = totalSec * config.fps
    const stepList = range(startStep, endStep, (endStep - startStep) / totalFrame)
    console.time('fillRank')
    const result = DataProcessor.fillRank(stepList, scaleMap, config)
    console.timeEnd('fillRank')
    DataProcessor.addTailingFrames(config, result)
    return result
  }

  private static fillRank(stepList: number[], scaleMap: Map<string, ScaleLinear<unknown, unknown, unknown>>, config: Config) {
    return stepList.map((step) => {
      const list: any[] = []
      scaleMap.forEach((scale) => {
        const scaledData = scale(step)
        if (scaledData) {
          const d = Object.assign({}, scaledData)
          list.push(d)
        }
      })
      // 根据 value 排序
      list.sort((a, b) => {
        // 如果是 NaN 则排在最后
        if (Number.isNaN(a.value)) {
          return 1
        }
        if (Number.isNaN(b.value)) {
          return -1
        }
        return b.value - a.value
      })
      // 多留一位
      return list.slice(0, config.topN + 1).map((d, i) => {
        d.rank = i // 填上排名
        return d
      })
    })
  }

  private static addTailingFrames(config: Config, result: any[][]) {
    // swap 占用的帧数：
    const swapFrames = config.swapDurationSec * config.fps
    // 最后需要留出一次交换的时间，将最后一帧的数据复制 swapFrames 次
    for (let i = 0; i < swapFrames; i++) {
      // 为了避免引用问题，需要深拷贝
      result.push(result[result.length - 1].map((d: any) => Object.assign({}, d)))
    }
    const groupIDResult = group(result.flat(), d => d.id)
    groupIDResult.forEach((group) => {
      group.sort((a, b) => a.step - b.step)
      const ranks = group.map(d => d.rank)
      const swapFrames = config.swapDurationSec * config.fps
      const blurRanks = blur(ranks, swapFrames / 6)

      group.forEach((d, i) => {
        d.blurRank = blurRanks[i]
        // 如果 blur rank 在 TopN - 1 ~ TopN 之间，则需要调整 alpha
        // 如果 TopN 是 20，那么 blurRank 在 19 ~ 20 之间的 alpha 为 1 ~ 0，越靠近 20，alpha 越小
        if (d.blurRank >= config.topN - 1) {
          d.alpha = 1 - (d.blurRank - config.topN + 1)
        }
        // 还需要检查是否是上升还是下降。
        // 检查方式为，如果 i > 0，且 blurRanks[i] < blurRanks[i - 1]，则是上升，否则是下降
        if (i > 0) {
          d.up = blurRanks[i] < blurRanks[i - 1]
        }
      })
    })
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
        // 值不能是 ID
        if (d[key] !== result.id) {
          // 如果值能被转换成数字，则转换成数字，加入到对象中
          if (!Number.isNaN(Number(d[key]))) {
            result[key] = Number(d[key]) as any
          }
        }
      }
      return result
    })
    const topN = config.topN
    const stepGroup = group(temp, d => Math.floor(d.step))
    const idSet = new InternSet<string>()
    // 获取进入了 TopN 的 id
    stepGroup.forEach((group) => {
      group.sort((a, b) => b.value - a.value)
      group.slice(0, topN + 1).forEach(d => idSet.add(d.id)) // 多留一位
    })
    const idGroups = group(temp, d => d.id)
    const data = [...idGroups.values()].filter(group => idSet.has(group[0].id)).flat()
    return data
  }

  private static getScaleMap(idGroups: InternMap<string, Data[]>, endStep: number, stepSec: number, config: Config, startStep: number) {
    const scaleMap = new Map<string, ReturnType<typeof scaleLinear>>()
    idGroups.forEach((group, key) => {
      group = group.sort((a, b) => a.step - b.step)
      const last = group[group.length - 1]
      if ((endStep - last.step) * stepSec > config.maxRetentionTimeSec * 1000) {
        // 如果，最后一个时间戳距离结束时间超过了最大暂留时间，则需要插入 NaN
        // 在插入 NaN 之前，需要先插入一个时间戳，这个时间戳用于进入退出动画。
        group.push({
          id: last.id,
          label: last.label,
          value: last.value * config.decayRate,
          step: last.step + config.transitionDurationSec / stepSec, // 退出动画的终点
          alpha: 0,
          up: false,
          raw: last.raw,
        })
        group.push({
          id: last.id,
          label: last.label,
          value: Number.NaN,
          alpha: 0,
          step: endStep, // 最后一个时间戳
          raw: last.raw,
          up: false,
        })
      }
      let prevStep = startStep

      for (let i = 0; i < group.length; i++) {
        const cur = group[i]
        const curStep = cur.step
        if ((curStep - prevStep) * stepSec > config.maxRetentionTimeSec) {
          // 如果当前时间戳和上一个时间戳的间隔超过了最大时间间隔，则需要插入 NaN
          // 一个需要插入在 prevStep 后 maxIntervalStep 的位置
          // 一个需要插入在 curStep 前 maxIntervalStep 的位置
          group.splice(i, 0, {
            id: cur.id,
            label: cur.label,
            value: cur.value * config.decayRate,
            step: prevStep + config.transitionDurationSec / stepSec,
            raw: cur.raw,
            alpha: 0,
            up: false,
          })
          i++ // 插入了一个元素，所以需要跳过这个元素

          // 在中间插入 NaN
          group.splice(i, 0, {
            id: cur.id,
            label: cur.label,
            value: cur.value * config.decayRate,
            step: prevStep + config.maxRetentionTimeSec / stepSec,
            raw: cur.raw,
            alpha: 0,
            up: false,
          })
          i++ // 插入了一个元素，所以需要跳过这个元素

          // 如果正好两倍则只用插入一个，否则还需要插入一个，这个插在 curStep 前 maxIntervalStep 的位置，用于进入动画
          group.splice(i, 0, {
            id: cur.id,
            label: cur.label,
            value: cur.value * config.decayRate,
            step: curStep - config.transitionDurationSec / stepSec,
            raw: cur.raw,
            alpha: 0,
            up: true,
          })
          i++ // 插入了一个元素，所以需要跳过这个元素
        }
        // 如果 cur 的值是 NaN，则前后点需要加过渡元素
        if (Number.isNaN(cur.value)) {
          if (i > 0) {
            const p = group[i - 1] // 前一个节点后，退出
            if (!Number.isNaN(p.value)) {
              group.splice(i, 0, {
                id: p.id,
                label: p.label,
                value: p.value * config.decayRate,
                step: p.step + config.transitionDurationSec / stepSec,
                raw: p.raw,
                alpha: 0,
                up: false,
              })
              i++
            }
          }
          if (i < group.length - 1) {
            const n = group[i + 1] // 后一个节点前，进入
            if (!Number.isNaN(n.value)) {
              group.splice(i + 1, 0, {
                id: n.id,
                label: n.label,
                value: n.value * config.decayRate,
                step: n.step - config.transitionDurationSec / stepSec,
                raw: n.raw,
                alpha: 0,
                up: true,
              })
              i++
            }
          }
        }
        prevStep = curStep
      }
      const scale = scaleLinear<{
        id: string
        label: string
        value: number
        step: number
        raw: any
      }>().domain(group.map(d => d.step)).range(group).clamp(true).interpolate((a, b) => {
        const inter = interpolate(a, b)
        const raw = { ...a.raw }
        return (t) => {
          const res = inter(t)
          if (res) {
            res.raw = raw
          }
          return res
        }
      })
      scaleMap.set(key, scale)
    })
    return scaleMap
  }
}
