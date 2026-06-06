import { useDb } from '../../db'
import { dataset } from '../../db/schema'

// 浏览器直传 CSV 完成后，登记数据集元信息（原始文件已在对象存储）。
export default defineEventHandler(async (event) => {
  const { user } = await requireSession(event)

  const body = await readBody<{ name?: string, storageKey?: string, columns?: string[], rowCount?: number }>(event)
  if (!body?.name || !body?.storageKey) {
    throw createError({ statusCode: 400, statusMessage: '缺少 name 或 storageKey' })
  }
  // storageKey 必须落在自己的前缀下（presign 只会签发该前缀），防止指认他人对象
  if (!body.storageKey.startsWith(`datasets/${user.id}/`)) {
    throw createError({ statusCode: 403, statusMessage: 'storageKey 不合法' })
  }

  const columns = Array.isArray(body.columns) ? body.columns.filter(c => typeof c === 'string').slice(0, 200) : []
  const rowCount = Number.isFinite(Number(body.rowCount)) ? Math.max(0, Math.trunc(Number(body.rowCount))) : null

  const [row] = await useDb()
    .insert(dataset)
    .values({ userId: user.id, name: body.name.slice(0, 200), storageKey: body.storageKey, columns, rowCount })
    .returning({ id: dataset.id })

  return { id: row!.id }
})
