import type { ScaleLinear } from 'd3'
import type { Data } from '../Data'
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
  Object.assign(base, overrides)
  return base
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
    const range = scale!.range() as Data[]
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
    const range = scale!.range() as Data[]
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
    const range = scale!.range() as Data[]
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
})
