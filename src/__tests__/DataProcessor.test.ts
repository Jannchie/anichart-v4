import type { ScaleLinear } from 'd3'
import type { Data, RankedData } from '../Data'
import { describe, expect, it } from 'vitest'
import { Config } from '../Config'
import { DataProcessor } from '../DataProcessor'

type LinearScale = ScaleLinear<Data, Data>

const getScaleMap = (DataProcessor as any).getScaleMap as (
  idGroups: Map<string, Data[]>,
  endStep: number,
  stepSec: number,
  config: Config,
  startStep: number,
  transitionDurationSec: number,
) => Map<string, LinearScale>
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

describe('dataprocessor.getscalemap', () => {
  it('inserts exit placeholders when the final data point exceeds the retention window', () => {
    const id = 'alpha'
    const data: Data[] = [
      createData(id, 0, 10),
      createData(id, 2, 12),
      createData(id, 4, 14),
    ]
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const stepSec = 1
    const retentionSteps = config.maxRetentionTimeSec / stepSec
    const transitionSteps = transitionDurationSec / stepSec
    const endStep = data.at(-1)!.step + retentionSteps + transitionSteps
    const scaleMap = getScaleMap(new Map([[id, data]]) as any, endStep, stepSec, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    const domain = scale!.domain()
    const range = scale!.range()
    expect(domain).toEqual([
      0,
      2,
      4,
      4 + transitionSteps,
      4 + transitionSteps * 2,
      endStep,
    ])
    expect(range).toHaveLength(6)
    const exitNode = range[3]
    expect(exitNode.value).toBeCloseTo(14 * config.decayRate)
    expect(exitNode.alpha).toBe(0)
    expect(exitNode.up).toBe(false)
    expect(exitNode.step).toBeCloseTo(4 + transitionSteps)
    const fadeNode = range[4]
    expect(fadeNode.step).toBeCloseTo(4 + transitionSteps * 2)
    expect(fadeNode.value).toBeCloseTo(exitNode.value * config.decayRate)
    expect(fadeNode.alpha).toBe(0)
    expect(fadeNode.up).toBe(false)
    const trailingNode = range[5]
    expect(Number.isNaN(trailingNode.value)).toBe(true)
    expect(trailingNode.alpha).toBe(0)
    expect(trailingNode.step).toBe(endStep)
  })

  it('fills long gaps with decay and entry placeholders', () => {
    const id = 'beta'
    const data: Data[] = [
      createData(id, 0, 10),
      createData(id, 10, 20),
    ]
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const scaleMap = getScaleMap(new Map([[id, data]]) as any, 10, 1, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    const domain = scale!.domain()
    const range = scale!.range()
    expect(domain).toEqual([
      0,
      transitionDurationSec,
      config.maxRetentionTimeSec,
      10 - transitionDurationSec,
      10,
    ])
    const decayNode = range[1]
    expect(decayNode.value).toBeCloseTo(20 * config.decayRate)
    expect(decayNode.alpha).toBe(0)
    expect(decayNode.up).toBe(false)
    const middleNode = range[2]
    expect(middleNode.step).toBeCloseTo(config.maxRetentionTimeSec)
    expect(middleNode.value).toBeCloseTo(20 * config.decayRate)
    expect(middleNode.up).toBe(false)
    const entryNode = range[3]
    expect(entryNode.step).toBeCloseTo(10 - transitionDurationSec)
    expect(entryNode.value).toBeCloseTo(20 * config.decayRate)
    expect(entryNode.up).toBe(true)
  })

  it('surrounds nan values with transition nodes from neighboring data', () => {
    const id = 'gamma'
    const nanValue = Number.NaN
    const data: Data[] = [
      createData(id, 0, 30),
      createData(id, 5, nanValue),
      createData(id, 6, 40),
    ]
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const scaleMap = getScaleMap(new Map([[id, data]]) as any, 6, 1, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    const domain = scale!.domain()
    const range = scale!.range()
    expect(domain).toEqual([
      0,
      transitionDurationSec,
      5,
      6 - transitionDurationSec,
      6,
    ])
    const exitNode = range[1]
    expect(exitNode.value).toBeCloseTo(30 * config.decayRate)
    expect(exitNode.up).toBe(false)
    expect(exitNode.alpha).toBe(0)
    const nanNode = range[2]
    expect(Number.isNaN(nanNode.value)).toBe(true)
    const entryNode = range[3]
    expect(entryNode.value).toBeCloseTo(40 * config.decayRate)
    expect(entryNode.alpha).toBe(0)
    expect(entryNode.up).toBe(true)
  })

  it('does not mutate the original id group array', () => {
    const id = 'delta'
    const originalGroup = [
      createData(id, 0, 3),
      createData(id, 1, 5),
    ]
    const snapshot = originalGroup.map(d => ({ ...d }))
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const scaleMap = getScaleMap(new Map([[id, originalGroup]]) as any, 2, 1, config, 0, transitionDurationSec)
    expect(scaleMap.get(id)).toBeDefined()
    expect(originalGroup).toHaveLength(snapshot.length)
    for (const [index, item] of originalGroup.entries()) {
      expect(item).toStrictEqual(snapshot[index])
    }
  })

  it('keeps the original domain when gaps stay within retention window', () => {
    const id = 'epsilon'
    const data: Data[] = [
      createData(id, 0, 5),
      createData(id, 1, 7),
      createData(id, 2, 9),
    ]
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const scaleMap = getScaleMap(new Map([[id, data]]) as any, 2, 1, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    expect(scale!.domain()).toEqual([0, 1, 2])
    expect(scale!.range()).toHaveLength(3)
  })

  it('adds an entry transition when the first point is nan', () => {
    const id = 'zeta'
    const data: Data[] = [
      createData(id, 0, Number.NaN, { alpha: 0 }),
      createData(id, 4, 12),
    ]
    const config = new Config()
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const stepSec = 1
    const transitionSteps = transitionDurationSec / stepSec
    const scaleMap = getScaleMap(new Map([[id, data]]) as any, 4, stepSec, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    const domain = scale!.domain()
    expect(domain.at(0)).toBe(0)
    expect(domain.at(1)).toBeCloseTo(4 - transitionSteps)
    const range = scale!.range()
    const transitionNode = range[1]
    expect(transitionNode.value).toBeCloseTo(12 * config.decayRate)
    expect(transitionNode.up).toBe(true)
    expect(transitionNode.alpha).toBe(0)
  })

  it('prefers the nearest raw snapshot during interpolation', () => {
    const id = 'eta'
    const a = createData(id, 0, 10, { raw: { source: 'a' } })
    const b = createData(id, 10, 20, { raw: { source: 'b' } })
    const config = new Config({ maxRetentionTimeSec: 100 })
    const transitionDurationSec = Math.min(config.transitionDurationSec, config.maxRetentionTimeSec / 2)
    const scaleMap = getScaleMap(new Map([[id, [a, b]]]) as any, 10, 1, config, 0, transitionDurationSec)
    const scale = scaleMap.get(id)
    expect(scale).toBeDefined()
    const interpolated = scale!(7)
    expect(interpolated.raw).toEqual({ source: 'b' })
    expect(interpolated.raw).not.toBe(b.raw)
    const nearStart = scale!(2)
    expect(nearStart.raw).toEqual({ source: 'a' })
    expect(nearStart.raw).not.toBe(a.raw)
  })
})

function createConstantScale(data: Data | undefined): LinearScale {
  const scale = ((_: number) => data) as unknown as LinearScale
  return scale
}

describe('dataprocessor.fillrank', () => {
  const fillRank = (DataProcessor as any).fillRank as (
    stepList: number[],
    scaleMap: Map<string, LinearScale>,
    config: Config,
  ) => any[][]

  it('orders entries by value and keeps topn plus one extra', () => {
    const config = new Config({ topN: 2 })
    const stepList = [0]
    const scales = new Map<string, LinearScale>([
      ['alpha', createConstantScale(createData('alpha', 0, 12))],
      ['beta', createConstantScale(createData('beta', 0, 30))],
      ['gamma', createConstantScale(createData('gamma', 0, Number.NaN))],
      ['delta', createConstantScale(createData('delta', 0, 20))],
    ])
    const frames = fillRank(stepList, scales, config)
    expect(frames).toHaveLength(1)
    const [frame] = frames
    expect(frame).toHaveLength(config.topN + 1)
    const values = frame.map(d => d.value)
    expect(values).toEqual([30, 20, 12])
    for (const [index, item] of frame.entries()) {
      expect(item.rank).toBe(index)
    }
    const ids = frame.map(d => d.id)
    expect(ids).not.toContain('gamma')
  })
})

describe('dataprocessor.addtailingframes', () => {
  it('clamps alpha values within valid bounds after smoothing', () => {
    const config = new Config({ topN: 2, swapDurationSec: 1, fps: 2 })
    const createRanked = (step: number): RankedData => ({
      id: 'alpha',
      label: 'alpha',
      value: 10,
      step,
      alpha: 1,
      raw: { id: 'alpha', step },
      up: false,
      rank: config.topN + 2,
      blurRank: config.topN + 2,
    })
    const result: RankedData[][] = [
      [createRanked(0)],
      [createRanked(1)],
    ]

    addTailingFrames(config, result)
    const alphas = result.flat().map(d => d.alpha)

    for (const value of alphas) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(alphas).toContain(0)
  })
})

describe('dataprocessor.preprocess', () => {
  it('retains label-like fields as strings even when numeric-looking', () => {
    const config = new Config({
      idField: 'id',
      labelField: 'name',
      valueField: 'metric',
      stepField: 'step',
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
