import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { user, work } from '../../db/schema'

// 按 slug 取单个作品（分享页用）。private 仅作者可见；public / unlisted 凭 slug 可访问。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const db = useDb()
  const [row] = await db.select().from(work).where(eq(work.slug, slug)).limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '作品不存在' })
  }

  if (row.visibility === 'private') {
    const sessionData = await useAuth().api.getSession({ headers: event.headers })
    // 不泄露私有作品的存在性，统一按 404 处理
    if (sessionData?.user?.id !== row.userId) {
      throw createError({ statusCode: 404, statusMessage: '作品不存在' })
    }
  }

  // 作者公开信息（观看页作者行 / 频道入口）
  const [author] = await db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1)

  // 播放计数走 POST /api/works/[slug]/view（观看页挂载时调用）
  // 投影返回，不外泄内部 userId
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    slug: row.slug,
    datasetId: row.datasetId,
    chartConfig: row.chartConfig,
    visibility: row.visibility,
    posterKey: row.posterKey,
    views: row.views,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author,
  }
})
