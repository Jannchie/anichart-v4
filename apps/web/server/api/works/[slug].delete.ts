import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { work } from '../../db/schema'

// 删除作品：连带清掉对象存储里的封面；dataset 暂留（FK restrict，后续 GC）。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { work: row } = await requireWorkOwner(event, slug)

  await useDb().delete(work).where(eq(work.id, row.id))

  if (row.posterKey) {
    try {
      await deleteObject(row.posterKey)
    }
    catch { /* 封面清理失败不阻塞删除 */ }
  }

  return { ok: true }
})
