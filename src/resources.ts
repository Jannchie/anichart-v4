import type { Texture } from 'pixi.js'
import { scaleOrdinal, schemeTableau10 } from 'd3'

export const colors = scaleOrdinal(schemeTableau10)

export const colorMap = new Map<string, number>()
export const textureMap = new Map<string, Texture>()
