// server 侧 slug 生成：与 app/lib/store.ts 的 makeSlug 同规则。
// 不直接 import app/lib（server 与 app 构建上下文分离），各自维护这份小函数。
export function makeWorkSlug(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^\w一-龥-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 7)
  return base ? `${base}-${suffix}` : suffix
}
