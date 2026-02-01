import type { TextStyle } from 'pixi.js'
import { CanvasTextMetrics } from 'pixi.js'

function getTextWidthCacheKey(text: string, style: TextStyle) {
  const fontFamily = Array.isArray(style.fontFamily) ? style.fontFamily.join(',') : style.fontFamily ?? ''
  const fontSize = typeof style.fontSize === 'number' ? style.fontSize : String(style.fontSize ?? '')
  return `${fontFamily}|${fontSize}|${text}`
}

export function measureTextWidth(text: string, style: TextStyle, cache: Map<string, number>) {
  const cacheKey = getTextWidthCacheKey(text, style)
  const cached = cache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  try {
    const width = CanvasTextMetrics.measureText(text, style).width
    cache.set(cacheKey, width)
    return width
  }
  catch {
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : Number.parseFloat(String(style.fontSize ?? 0)) || 0
    const fallbackWidth = text.length * fontSize * 0.6
    cache.set(cacheKey, fallbackWidth)
    return fallbackWidth
  }
}
