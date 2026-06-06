import type { ChartSpec } from './chart-spec'

// 发布编排：presign 直传 CSV → 登记 dataset → 创建/更新 work（封面 base64 由服务端中转）。
// CSV 用内容指纹判断是否复用已有 dataset（编辑再发布且数据没变时不重传）。

export type Visibility = 'public' | 'unlisted' | 'private'

export interface PublishInput {
  title: string
  description: string
  visibility: Visibility
  spec: ChartSpec
  csvText: string
  fileName: string
  columns: string[]
  rowCount: number
  posterDataUrl?: string
  // 已发布过的作品（更新）：datasetId+csvHash 用于复用判断
  existing?: { slug: string, datasetId: string, csvHash: string }
}

export interface PublishResult {
  slug: string
  datasetId: string
  csvHash: string
}

export async function hashCsv(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadDataset(input: PublishInput): Promise<string> {
  const file = input.fileName.endsWith('.csv') ? input.fileName : `${input.fileName || 'data'}.csv`
  const size = new TextEncoder().encode(input.csvText).byteLength

  const presign = await $fetch<{ key: string, url: string, contentType: string }>('/api/datasets/presign', {
    method: 'POST',
    body: { filename: file, contentType: 'text/csv', size },
  })

  // Content-Type 必须与签名完全一致（用 presign 回传的归一值）
  const res = await fetch(presign.url, {
    method: 'PUT',
    headers: { 'Content-Type': presign.contentType },
    body: input.csvText,
  })
  if (!res.ok)
    throw new Error(`数据上传失败（${res.status}）`)

  const ds = await $fetch<{ id: string }>('/api/datasets', {
    method: 'POST',
    body: { name: file, storageKey: presign.key, columns: input.columns, rowCount: input.rowCount },
  })
  return ds.id
}

export async function publishWork(input: PublishInput): Promise<PublishResult> {
  const csvHash = await hashCsv(input.csvText)

  // 数据没变 → 复用 dataset；否则上传新数据集
  const datasetId = input.existing && input.existing.csvHash === csvHash
    ? input.existing.datasetId
    : await uploadDataset(input)

  const body = {
    title: input.title,
    description: input.description,
    visibility: input.visibility,
    datasetId,
    chartConfig: input.spec,
    posterDataUrl: input.posterDataUrl,
  }

  if (input.existing) {
    await $fetch(`/api/works/${input.existing.slug}`, { method: 'PATCH', body })
    return { slug: input.existing.slug, datasetId, csvHash }
  }

  const created = await $fetch<{ id: string, slug: string }>('/api/works', { method: 'POST', body })
  return { slug: created.slug, datasetId, csvHash }
}
