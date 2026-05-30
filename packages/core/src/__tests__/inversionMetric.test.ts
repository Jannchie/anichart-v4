import type { RankedData } from '../Data'
import { describe, expect, it } from 'vitest'
import { computeInversionMetrics } from '../utils/inversionMetric'

function bar(id: string, value: number, blurRank: number, alpha = 1): RankedData {
  return { id, label: id, value, step: 0, alpha, raw: { id }, up: false, rank: blurRank, blurRank }
}

describe('computeinversionmetrics', () => {
  it('no inversion when value desc aligns with blurrank asc', () => {
    const frames = [[bar('A', 100, 0), bar('B', 80, 1), bar('C', 60, 2)]]
    const m = computeInversionMetrics(frames, { fps: 60 })
    expect(m.inversionFrames).toBe(0)
    expect(m.inversionPairFrames).toBe(0)
    expect(m.maxDepth).toBe(0)
  })

  it('counts a single inversion pair (longer bar below shorter)', () => {
    // A 更长(value 100) 却排在 B(value 80) 下方(blurRank 1 > 0) → 1 个逆序对。
    const frames = [[bar('B', 80, 0), bar('A', 100, 1)]]
    const m = computeInversionMetrics(frames, { fps: 60 })
    expect(m.inversionPairFrames).toBe(1)
    expect(m.inversionFrames).toBe(1)
    expect(m.maxDepth).toBe(1)
    expect(m.worstFrame).toBe(0)
  })

  it('one暴涨 bar below three others = 3 pairs in that frame', () => {
    // E value 最大但 blurRank 最大(还在底部) → 与 A/B/C 各成一对。
    const frames = [[bar('A', 100, 0), bar('B', 80, 1), bar('C', 60, 2), bar('E', 200, 3)]]
    const m = computeInversionMetrics(frames, { fps: 60 })
    expect(m.maxDepth).toBe(3)
    expect(m.inversionPairFrames).toBe(3)
  })

  it('ignores invisible bars (alpha below threshold)', () => {
    // E 逆序但 alpha=0（屏外 parking）→ 不计入。
    const frames = [[bar('A', 100, 0), bar('E', 200, 3, 0)]]
    const m = computeInversionMetrics(frames, { fps: 60 })
    expect(m.inversionPairFrames).toBe(0)
  })

  it('inversionseconds = inversionframes / fps', () => {
    const frame = [bar('B', 80, 0), bar('A', 100, 1)]
    const frames = [frame, frame, frame] // 3 帧都逆序
    const m = computeInversionMetrics(frames, { fps: 60 })
    expect(m.inversionFrames).toBe(3)
    expect(m.inversionSeconds).toBeCloseTo(3 / 60, 9)
  })

  it('smoothnessenergy is 0 for a static blurrank trajectory, >0 when it accelerates', () => {
    const flat = [[bar('A', 100, 0)], [bar('A', 100, 0)], [bar('A', 100, 0)]]
    expect(computeInversionMetrics(flat, { fps: 60 }).smoothnessEnergy).toBeCloseTo(0, 9)
    const moving = [[bar('A', 100, 0)], [bar('A', 100, 1)], [bar('A', 100, 3)]]
    expect(computeInversionMetrics(moving, { fps: 60 }).smoothnessEnergy).toBeGreaterThan(0)
  })
})
