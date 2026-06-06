import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../db'
import { work } from '../db/schema'

// 统一的鉴权助手：所有写端点都走这两个函数，避免每个 handler 重复 session/所有权样板。

// 取当前登录会话，未登录抛 401。
export async function requireSession(event: H3Event) {
  const sessionData = await useAuth().api.getSession({ headers: event.headers })
  if (!sessionData?.user) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  return sessionData
}

// 按 slug 取作品并校验归属。不泄露他人作品的存在性，统一按 404 处理。
// 用 slug 而非 id：works/ 下同一路径段的动态参数名必须一致（radix 路由限制），读端点已占用 [slug]。
export async function requireWorkOwner(event: H3Event, slug: string) {
  const sessionData = await requireSession(event)
  const db = useDb()
  const [row] = await db.select().from(work).where(eq(work.slug, slug)).limit(1)
  if (!row || row.userId !== sessionData.user.id) {
    throw createError({ statusCode: 404, statusMessage: '作品不存在' })
  }
  return { work: row, user: sessionData.user }
}
