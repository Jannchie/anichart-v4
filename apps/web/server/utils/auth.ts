import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { schema, useDb } from '../db'

function createAuth() {
  const config = useRuntimeConfig()
  return betterAuth({
    secret: config.betterAuthSecret ?? 'dev-insecure-secret',
    baseURL: config.public.authBaseUrl,
    database: drizzleAdapter(useDb(), { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
  })
}

let _auth: ReturnType<typeof createAuth> | undefined

// 惰性单例：在请求期按 runtimeConfig 构建 better-auth
export function useAuth() {
  _auth ??= createAuth()
  return _auth
}
