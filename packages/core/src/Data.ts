export interface Data {
  id: string
  label: string
  value: number
  step: number
  alpha: number
  raw: any

  [key: string]: any
}

export interface RankedData extends Data {
  rank: number
  blurRank: number
  // 柱体最终不透明度（由 applyVelocity 写入，BarChart 直接取用）。
  // 一般 = parkingMask(纵向位置决定)；未满榜入场柱则就地走 enter ramp 淡入。
  renderAlpha?: number
  // 渲染层级（由 assignZOrder 离线预计算，BarChart 直接取用作 PIXI zIndex，越大越上层）：
  // 重叠期按「进入时的向上速率」锁定、上浮快者在上。预计算保证 update(frame) 仍是 frame 的纯函数
  // —— Remotion 并发分块/进度条跳转任意帧都得到同一层叠。手造数据（未经 DataProcessor）时缺省。
  zIndex?: number
}
