import { describe, expect, it } from 'vitest'
import { Config } from '../Config'

describe('config defaults', () => {
  it('applies documented defaults', () => {
    const c = new Config()
    expect(c.topN).toBe(16)
    expect(c.fps).toBe(60)
    expect(c.totalDurationSec).toBe(60)
    expect(c.maxRetentionTimeSec).toBe(50)
    expect(c.transitionDurationSec).toBe(4)
    expect(c.swapAlgorithm).toBe('velocity-accel')
    expect(c.swapDurationSec).toBe(0.8)
    expect(c.swapAccelBoost).toBe(2)
    expect(c.lineTimeAxisMode).toBe('dynamic')
    expect(c.lineTimeWindowRatio).toBe(0.35)
    expect(c.valueScaleType).toBe('adaptive')
    expect(c.showStepLabel).toBe(true)
    expect(c.showLabel).toBe(false)
    expect(c.canvasWidth).toBe(1920)
    expect(c.canvasHeight).toBe(1080)
  })

  it('derives width/height from canvas size minus margin', () => {
    const c = new Config({ canvasWidth: 800, canvasHeight: 600 })
    expect(c.width).toBe(780)
    expect(c.height).toBe(580)
  })

  it('honors explicit width/height over the derived value', () => {
    const c = new Config({ width: 100, height: 50 })
    expect(c.width).toBe(100)
    expect(c.height).toBe(50)
  })

  it('derives valuescalesmoothing from swapdurationsec and fps', () => {
    // round(0.8 * 60 / 2) = 24
    expect(new Config({ swap: { durationSec: 0.8 }, fps: 60 }).valueScaleSmoothing).toBe(24)
    // max(1, round(0)) = 1
    expect(new Config({ swap: { durationSec: 0 }, fps: 60 }).valueScaleSmoothing).toBe(1)
  })
})

describe('config accessors', () => {
  it('resolves string fields against the row', () => {
    const c = new Config({ id: 'name', value: 'score' })
    expect(c.getID({ name: 'x' })).toBe('x')
    expect(c.getValue({ score: '42' })).toBe(42)
  })

  it('uses function accessors directly', () => {
    const c = new Config({ id: (d: any) => `#${d.k}`, value: (d: any) => d.v * 2 })
    expect(c.getID({ k: 'a' })).toBe('#a')
    expect(c.getValue({ v: 5 })).toBe(10)
  })

  it('label follows the id column when omitted', () => {
    const c = new Config({ id: 'name' })
    expect(c.labelField).toBe('name')
    expect(c.getLabel({ name: 'foo' })).toBe('foo')
  })

  it('falls back to the id column for color/image field defaults', () => {
    const c = new Config()
    expect(c.colorField).toBe('id')
    expect(c.imageField).toBe('id')
  })

  it('default getvaluelabel formats value with no decimals', () => {
    const c = new Config()
    expect(c.getValueLabel({ value: 3.7 } as any)).toBe('4')
  })
})

describe('config step parsing', () => {
  it('parses a numeric step as-is', () => {
    const c = new Config({ step: 'date' })
    expect(c.getStep({ date: '1700000000' })).toBe(1_700_000_000)
  })

  it('parses a date string to epoch millis', () => {
    const c = new Config({ step: 'date' })
    expect(c.getStep({ date: '2020-01-01T00:00:00Z' })).toBe(Date.parse('2020-01-01T00:00:00Z'))
  })

  it('throws on an unparseable step', () => {
    const c = new Config({ step: 'date' })
    expect(() => c.getStep({ date: 'not-a-date' })).toThrow()
  })
})

describe('config valuescale discriminated union', () => {
  it('from-delta carries its delta, defaulting to 300', () => {
    expect(new Config({ valueScale: { type: 'from-delta' } }).valueScaleDelta).toBe(300)
    expect(new Config({ valueScale: { type: 'from-delta', delta: 42 } }).valueScaleDelta).toBe(42)
  })

  it('adaptive carries ratio bounds, with defaults and overrides', () => {
    const c = new Config({ valueScale: { type: 'adaptive' } })
    expect(c.valueScaleType).toBe('adaptive')
    expect(c.valueScaleMinRatio).toBe(0.15)
    expect(c.valueScaleMaxRatio).toBe(0.55)
    const o = new Config({ valueScale: { type: 'adaptive', minRatio: 0.2, maxRatio: 0.6 } })
    expect(o.valueScaleMinRatio).toBe(0.2)
    expect(o.valueScaleMaxRatio).toBe(0.6)
  })

  it('non-delta types still expose a delta fallback', () => {
    expect(new Config({ valueScale: { type: 'from-zero' } }).valueScaleDelta).toBe(300)
  })
})

describe('config barheight', () => {
  it('auto enables autobarheight with a seed height', () => {
    const c = new Config()
    expect(c.autoBarHeight).toBe(true)
    expect(c.barHeight).toBe(24)
  })

  it('a numeric barheight disables auto', () => {
    const c = new Config({ barHeight: 40 })
    expect(c.autoBarHeight).toBe(false)
    expect(c.barHeight).toBe(40)
  })
})

describe('config swap nested input', () => {
  it('normalizes the swap sub-config to flat fields', () => {
    const c = new Config({ swap: { algorithm: 'velocity', durationSec: 1.2, accelBoost: 5 } })
    expect(c.swapAlgorithm).toBe('velocity')
    expect(c.swapDurationSec).toBe(1.2)
    expect(c.swapAccelBoost).toBe(5)
  })
})
