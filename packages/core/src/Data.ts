export interface Data {
  id: string
  label: string
  value: number
  step: number
  alpha: number
  raw: any
  up: boolean

  [key: string]: any
}

export interface RankedData extends Data {
  rank: number
  blurRank: number
  // 柱体最终不透明度（由 applyVelocity 写入，BarChart 直接取用）。
  // 一般 = parkingMask(纵向位置决定)；未满榜入场柱则就地走 enter ramp 淡入。
  renderAlpha?: number
}
