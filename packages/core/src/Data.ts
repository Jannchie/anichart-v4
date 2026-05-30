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
}
