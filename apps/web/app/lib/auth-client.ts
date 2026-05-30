import { createAuthClient } from 'better-auth/vue'

// 同源时默认指向 /api/auth，无需配置 baseURL
export const authClient = createAuthClient()
