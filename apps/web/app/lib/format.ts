// 列表/观看页的展示格式化（YouTube 式相对时间与计数缩写）。

export function timeAgo(input: number | string | Date): string {
  const t = new Date(input).getTime()
  if (Number.isNaN(t))
    return ''
  const diff = Date.now() - t
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min)
    return '刚刚'
  if (diff < hour)
    return `${Math.floor(diff / min)} 分钟前`
  if (diff < day)
    return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day)
    return `${Math.floor(diff / day)} 天前`
  if (diff < 365 * day)
    return `${Math.floor(diff / (30 * day))} 个月前`
  return `${Math.floor(diff / (365 * day))} 年前`
}

export function formatViews(n: number | undefined | null): string {
  const v = n ?? 0
  if (v >= 10_000)
    return `${(v / 10_000).toFixed(v >= 100_000 ? 0 : 1)} 万`
  return String(v)
}

// posterKey（posters/<uid>/<wid>.png）→ 同源代理 URL；updatedAt 做缓存破坏
export function posterUrl(posterKey: string | null | undefined, updatedAt?: number | string | Date): string | null {
  if (!posterKey)
    return null
  const v = updatedAt ? `?v=${new Date(updatedAt).getTime()}` : ''
  return `/api/${posterKey}${v}`
}
