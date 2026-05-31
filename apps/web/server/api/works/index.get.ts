import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { work } from '../../db/schema'

// 公开作品列表（首页 feed）。骨架版：取最新 50 条 public 作品。
export default defineEventHandler(async () => {
  const db = useDb()
  return db
    .select()
    .from(work)
    .where(eq(work.visibility, 'public'))
    .orderBy(desc(work.createdAt))
    .limit(50)
})
