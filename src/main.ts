// import type { Texture } from 'pixi.js'
// import { Application, Assets, Container, Sprite, Text } from 'pixi.js'
// import './style.css'
// import { scaleLinear, scaleOrdinal, schemeTableau10 } from 'd3'
// import dayjs from 'dayjs'
// import { DataProcessor } from './DataProcessor'
// import { BarChart } from './BarChart'
// import { Config } from './Config'

import { scaleOrdinal, schemeTableau10 } from 'd3'
import type { Texture } from 'pixi.js'

export const colors = scaleOrdinal(schemeTableau10)

export const colorMap = new Map<string, number>()
export const imageMap = new Map<string, string>()

// import type { Data } from './Data'
export const textureMap = new Map<string, Texture>()
