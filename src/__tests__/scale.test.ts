import { describe, expect, it } from 'vitest'
import { adaptiveDomainMin, getValueScale } from '../utils/scale'

describe('getvaluescale adaptive (soft-saturation)', () => {
  const opt = { referenceSpan: 100, minRatio: 0.15, maxRatio: 0.55 }

  it('maps max→1 and last bar to r, with span=s giving the range midpoint', () => {
    const s = getValueScale('adaptive', 100, 200, 1000, opt) // span = 100 = S
    expect(s(200)).toBeCloseTo(1, 5)
    expect(s(100)).toBeCloseTo(0.35, 5) // r = 0.15 + 0.4·2^(-1) = 0.35
  })

  it('last bar ratio decreases monotonically as span grows', () => {
    const rSmall = getValueScale('adaptive', 195, 200, 1000, opt)(195) // span ≪ S
    const rMid = getValueScale('adaptive', 100, 200, 1000, opt)(100) // span = S
    const rLarge = getValueScale('adaptive', 0, 1000, 1000, opt)(0) // span ≫ S
    expect(rSmall).toBeGreaterThan(rMid)
    expect(rMid).toBeGreaterThan(rLarge)
  })

  it('soft floor: span approaches minratio but never clamps to 0', () => {
    const rTiny = getValueScale('adaptive', 199, 200, 1000, opt)(199)
    expect(rTiny).toBeLessThan(0.55)
    expect(rTiny).toBeGreaterThan(0.5)
    // 大 span：r 已逼近 rMin 但仍严格大于它（软饱和，不是硬 clamp）
    const rBig = getValueScale('adaptive', 0, 500, 1000, opt)(0) // 2^-5 ≈ 0.031
    expect(rBig).toBeGreaterThan(0.15)
    expect(rBig).toBeLessThan(0.2)
    // 极端 span：渐近触及 rMin，但绝不低于它、不为负、不消失（from-delta 会 clamp 成 0）
    const rHuge = getValueScale('adaptive', 0, 1e6, 1000, opt)(0)
    expect(rHuge).toBeGreaterThanOrEqual(0.15)
    expect(rHuge).toBeGreaterThan(0)
  })

  it('adaptivedomainmin is the inverse of the target ratio', () => {
    const min = 100
    const max = 200
    const domainMin = adaptiveDomainMin(min, max, 100, 0.15, 0.55)
    const r = (min - domainMin) / (max - domainMin)
    expect(r).toBeCloseTo(0.35, 6)
  })
})
