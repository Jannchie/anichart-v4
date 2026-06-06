import type { ChartSpec } from '~/lib/chart-spec'

// 服务端 works API 的响应形状（与 server/api/works/* 的投影保持一致）。

export interface ApiAuthor {
  id: string
  name: string
  image: string | null
}

export interface ApiWorkListItem {
  id: string
  title: string
  description: string | null
  slug: string
  kind: string
  visibility: 'public' | 'unlisted' | 'private'
  posterKey: string | null
  views: number
  createdAt: string
  updatedAt: string
  author: ApiAuthor
}

export interface WorksPage {
  items: ApiWorkListItem[]
  nextCursor: string | null
}

export interface ApiWorkDetail {
  id: string
  title: string
  description: string | null
  slug: string
  datasetId: string
  chartConfig: Partial<ChartSpec>
  visibility: 'public' | 'unlisted' | 'private'
  posterKey: string | null
  views: number
  createdAt: string
  updatedAt: string
  author: ApiAuthor | undefined
}
