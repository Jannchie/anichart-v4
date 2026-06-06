import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { user, work } from '../../db/schema'

const MAX_LIMIT = 50

// 作品列表：feed / 搜索 / 频道页 / 工作室共用。
//   ?q=        模糊搜标题与描述
//   ?author=   按作者过滤；'me' 表示当前登录用户（含非公开作品）
//   ?cursor=   keyset 分页游标（上一页最后一项的 `${createdAt 毫秒}_${id}`）
//   ?limit=    每页条数，默认 24，上限 50
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  const author = typeof query.author === 'string' ? query.author : ''
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), MAX_LIMIT)

  const conds = []

  if (author === 'me') {
    const { user: me } = await requireSession(event)
    conds.push(eq(work.userId, me.id)) // 自己的作品全部可见
  }
  else if (author) {
    conds.push(eq(work.userId, author), eq(work.visibility, 'public'))
  }
  else {
    conds.push(eq(work.visibility, 'public'))
  }

  if (q) {
    conds.push(or(ilike(work.title, `%${q}%`), ilike(work.description, `%${q}%`))!)
  }

  // keyset 分页：(createdAt, id) 双键避免同时刻并列丢行
  if (typeof query.cursor === 'string' && query.cursor.includes('_')) {
    const [ts, id] = query.cursor.split('_')
    const at = new Date(Number(ts))
    if (!Number.isNaN(at.getTime()) && id) {
      conds.push(or(
        lt(work.createdAt, at),
        and(eq(work.createdAt, at), lt(work.id, id)),
      )!)
    }
  }

  const rows = await useDb()
    .select({
      id: work.id,
      title: work.title,
      description: work.description,
      slug: work.slug,
      // feed 卡片只需要图表类型，不拖整个 chartConfig
      kind: sql<string>`${work.chartConfig}->>'kind'`,
      visibility: work.visibility,
      posterKey: work.posterKey,
      views: work.views,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      author: { id: user.id, name: user.name, image: user.image },
    })
    .from(work)
    .innerJoin(user, eq(work.userId, user.id))
    .where(and(...conds))
    .orderBy(desc(work.createdAt), desc(work.id))
    .limit(limit)

  const last = rows.length === limit ? rows.at(-1) : undefined
  return {
    items: rows,
    nextCursor: last ? `${last.createdAt.getTime()}_${last.id}` : null,
  }
})
