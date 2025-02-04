import type { Texture } from 'pixi.js'
import { scaleOrdinal, schemeTableau10 } from 'd3'

export const colors = scaleOrdinal(schemeTableau10)

export const colorMap = new Map<string, number>()
export const imageMap = new Map<string, string>()

// import type { Data } from './Data'
export const textureMap = new Map<string, Texture>()
