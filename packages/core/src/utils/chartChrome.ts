import type { Config } from '../Config'
import { blur, median } from 'd3'

// BarChart 与 LineChart 共用的标题 / 坐标轴「外框」样式常量。
export const TITLE_FONT_SIZE = 36
export const TITLE_PADDING = 24
export const MUTED_LABEL_COLOR = 0xAA_AA_AA // 刻度文字、轴标签等次要文字
export const TICK_LINE_COLOR = 0x33_33_33 // 刻度引导线

// 屏内首尾差距的中位数，作为 adaptive 软饱和的参考尺度（半衰尺度）。
// BarChart 构造期与 DataProcessor.buildBaselineScale 共用同一份计算，
// 保证柱体值域与入场/出场基线一致——此前两处各写一份、仅靠注释维系同步。
export function computeReferenceSpan(spans: number[]): number {
  return median(spans.filter(s => s > 0)) ?? 1
}

// ticksAlpha 的时间平滑：按 swap 帧数的 1/6 做高斯模糊，让刻度淡入淡出更顺。两类图共用。
export function smoothTicksAlpha(ticksAlphaMap: Map<number, number[]>, config: Config): void {
  const swapFrames = config.swapDurationSec * config.fps
  for (const [tick, alphaList] of ticksAlphaMap.entries()) {
    ticksAlphaMap.set(tick, blur(alphaList, swapFrames / 6) as number[])
  }
}
