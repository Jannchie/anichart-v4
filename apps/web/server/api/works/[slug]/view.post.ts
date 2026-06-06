import { and, eq, ne, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { work } from '../../../db/schema'

// 播放计数：观看页挂载时 fire-and-forget 调一次。private 不计（也不暴露存在性）。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  await useDb()
    .update(work)
    .set({ views: sql`${work.views} + 1` })
    .where(and(eq(work.slug, slug), ne(work.visibility, 'private')))
  return { ok: true }
})
