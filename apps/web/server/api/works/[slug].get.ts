import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { work } from '../../db/schema'

// 按 slug 取单个作品（分享页用）。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const db = useDb()
  const [row] = await db.select().from(work).where(eq(work.slug, slug)).limit(1)
  if (!row)
    throw createError({ statusCode: 404, statusMessage: '作品不存在' })
  // TODO(future): 校验 visibility / 私有作品需登录；views++
  return row
})
