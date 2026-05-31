import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

// 惰性单例：首次使用时按 runtimeConfig 建连接，避免模块加载期读不到 env
export function useDb() {
  if (!_db) {
    const url = useRuntimeConfig().databaseUrl
    if (!url) {
      throw new Error('DATABASE_URL 未配置')
    }
    _db = drizzle(postgres(url), { schema })
  }
  return _db
}

export * as schema from './schema'
