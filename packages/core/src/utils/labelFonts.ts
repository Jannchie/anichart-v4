export function getValueLabelFontSize(barHeight: number) {
  const scaled = Math.round(barHeight * 0.7)
  return Math.max(scaled, 10)
}

export function getExtraValueLabelFontSize(valueFontSize: number) {
  const scaled = Math.round(valueFontSize * 0.5)
  return Math.max(scaled, 6)
}
