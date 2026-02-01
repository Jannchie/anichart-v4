import type { ValueScaleType } from '../Config'
import { scaleLinear } from 'd3'

interface ValueScaleOptions {
  ensureRange?: boolean
  zeroBaseline?: 'always' | 'min'
}

function ensureRange(minValue: number, maxValue: number) {
  if (!Number.isFinite(minValue)) {
    minValue = 0
  }
  if (!Number.isFinite(maxValue)) {
    maxValue = 1
  }
  if (minValue === maxValue) {
    const offset = minValue === 0 ? 1 : Math.abs(minValue) * 0.01 || 1
    return [minValue - offset, maxValue + offset] as const
  }
  if (minValue > maxValue) {
    return [maxValue, minValue] as const
  }
  return [minValue, maxValue] as const
}

function normalizeRange(minValue: number | undefined, maxValue: number | undefined, options: ValueScaleOptions) {
  let safeMin = minValue ?? 0
  let safeMax = maxValue ?? 1
  if (options.ensureRange) {
    ;[safeMin, safeMax] = ensureRange(safeMin, safeMax)
  }
  else {
    if (!Number.isFinite(safeMin)) {
      safeMin = 0
    }
    if (!Number.isFinite(safeMax)) {
      safeMax = 1
    }
  }
  return { safeMin, safeMax }
}

export function getValueScale(
  type: ValueScaleType,
  minValue: number | undefined,
  maxValue: number | undefined,
  delta: number = 1000,
  options: ValueScaleOptions = {},
) {
  const { safeMin, safeMax } = normalizeRange(minValue, maxValue, options)
  if (type === 'from-zero') {
    const zeroBase = options.zeroBaseline === 'min' ? Math.min(0, safeMin) : 0
    return scaleLinear().domain([zeroBase, safeMax]).range([0, 1])
  }
  if (type === 'from-min') {
    const span = safeMax - safeMin
    return scaleLinear().domain([safeMin - span, safeMax]).range([0, 1])
  }
  if (type === 'from-delta') {
    const baseMin = safeMax - delta
    const domainMin = options.ensureRange ? Math.min(baseMin, safeMin) : baseMin
    return scaleLinear().domain([domainMin, safeMax]).range([0, 1])
  }
  throw new Error('Unknown value scale type')
}
