import type { ValueScaleType } from '../Config'
import { scaleLinear } from 'd3'

interface ValueScaleOptions {
  ensureRange?: boolean
  zeroBaseline?: 'always' | 'min'
  referenceSpan?: number
  minRatio?: number
  maxRatio?: number
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
  if (type === 'adaptive') {
    const rMin = options.minRatio ?? 0.15
    const rMax = options.maxRatio ?? 0.55
    const S = options.referenceSpan ?? (safeMax - safeMin)
    let domainMin = adaptiveDomainMin(safeMin, safeMax, S, rMin, rMax)
    if (!(domainMin < safeMax)) {
      // span≤0（首尾等值）：给一点偏移避免 domain 退化为点
      domainMin = safeMax - (Math.abs(safeMax) * 0.01 || 1)
    }
    return scaleLinear().domain([domainMin, safeMax]).range([0, 1])
  }
  throw new Error('Unknown value scale type')
}

// 自适应软饱和：选 domainMin 使"最后一条相对长度" r 随首尾差距 span 软饱和落在 [minRatio, maxRatio]。
//   r = minRatio + (maxRatio − minRatio)·2^(−span / referenceSpan)，domainMin = min − r/(1−r)·span。
//   span 越大 r 越小（最后一条越短），但渐近趋于 minRatio、永不触及 → 不会被 clamp 成 0 / 消失。
//   referenceSpan（半衰尺度，一般取数据集 span 的中位数）：span = referenceSpan 时 r 落到范围中点。
// span≤0（首尾等值）退化返回 min，由调用方兜底偏移。
export function adaptiveDomainMin(min: number, max: number, referenceSpan: number, minRatio: number, maxRatio: number): number {
  const span = max - min
  if (!(span > 0)) {
    return min
  }
  const S = Math.max(referenceSpan, 1e-9)
  const r = minRatio + (maxRatio - minRatio) * 2 ** (-span / S)
  return min - (r / (1 - r)) * span
}
