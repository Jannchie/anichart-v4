import type { Texture } from 'pixi.js'
import { scaleOrdinal } from 'd3'

// 为深色背景调过的高饱和、和谐的分类配色（比 d3 schemeTableau10 更鲜活、更现代）。
const PALETTE = [
  '#5B8FF9', // 蓝
  '#5AD8A6', // 青绿
  '#F6BD16', // 琥珀
  '#E8684A', // 珊瑚红
  '#6DC8EC', // 天蓝
  '#9270CA', // 紫
  '#FF9D4D', // 橙
  '#269A99', // 深青
  '#FF99C3', // 粉
  '#A0D911', // 黄绿
  '#36CFC9', // 青
  '#945FB9', // 紫罗兰
]

export const colors = scaleOrdinal(PALETTE)

export const colorMap = new Map<string, number>()
export const textureMap = new Map<string, Texture>()
