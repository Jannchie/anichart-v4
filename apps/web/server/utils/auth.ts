import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { schema, useDb } from '../db'

function createAuth() {
  const config = useRuntimeConfig()
  const secret = config.betterAuthSecret
  if (!secret) {
    // 生产环境绝不回退到公开已知的默认密钥（否则会话可被伪造）；仅开发环境放行并告警。
    if (!import.meta.dev) {
      throw new Error('BETTER_AUTH_SECRET 未配置：生产环境必须设置，拒绝使用不安全的默认密钥')
    }
    console.warn('[auth] BETTER_AUTH_SECRET 未配置，开发环境回退到不安全的默认密钥')
  }
  return betterAuth({
    secret: secret ?? 'dev-insecure-secret',
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
