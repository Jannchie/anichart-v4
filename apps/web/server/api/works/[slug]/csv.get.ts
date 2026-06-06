import { eq } from 'drizzle-orm'
import { useDb } from '../../../db'
import { dataset, work } from '../../../db/schema'

// 作品数据回放：从对象存储代理 CSV 文本。
// 走服务端代理而非 presigned GET：可见性鉴权必须在服务端做，且同源免 CORS。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const db = useDb()

  const [row] = await db
    .select({ visibility: work.visibility, userId: work.userId, storageKey: dataset.storageKey })
    .from(work)
    .innerJoin(dataset, eq(work.datasetId, dataset.id))
    .where(eq(work.slug, slug))
    .limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '作品不存在' })
  }

  if (row.visibility === 'private') {
    const sessionData = await useAuth().api.getSession({ headers: event.headers })
    if (sessionData?.user?.id !== row.userId) {
      throw createError({ statusCode: 404, statusMessage: '作品不存在' })
    }
  }

  const text = await getObjectText(row.storageKey)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  // 数据集内容不可变（换数据 = 新 dataset），公开作品可以放心缓存
  if (row.visibility === 'public')
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return text
})
