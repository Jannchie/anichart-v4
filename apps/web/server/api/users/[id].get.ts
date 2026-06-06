import { and, count, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { user, work } from '../../db/schema'

// 频道页资料：公开的作者信息 + 公开作品数。
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const db = useDb()

  const [u] = await db
    .select({ id: user.id, name: user.name, image: user.image, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, id))
    .limit(1)
  if (!u) {
    throw createError({ statusCode: 404, statusMessage: '用户不存在' })
  }

  const [c] = await db
    .select({ workCount: count() })
    .from(work)
    .where(and(eq(work.userId, id), eq(work.visibility, 'public')))

  return { ...u, workCount: c?.workCount ?? 0 }
})
