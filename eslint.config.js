import jannchie from '@jannchie/eslint-config'

export default jannchie({
  ignores: [
    '**/public/**',
    '**/dist/**',
    '**/.output/**',
    '**/.nuxt/**',
    'apps/studio/**',
    // 客户端（Vue SFC + composables）依赖 Nuxt 的解析与 auto-import；交给 Nuxt 自身的 lint，
    // 这里只把服务端与配置文件纳入。
    'apps/web/app/**',
  ],
  rules: {
    'unicorn/no-array-callback-reference': 'off',
  },
}, {
  // 测试里 helper 与 describe 块就近放置是惯例；consistent-function-scoping 在测试中是噪音（还会级联）。
  files: ['**/*.test.ts', '**/__tests__/**'],
  rules: {
    'unicorn/consistent-function-scoping': 'off',
  },
}, {
  // Nuxt/Nitro 服务端：h3 处理器、runtimeConfig 与项目 server-utils 都走 auto-import（不经 import），
  // 声明为全局以避免 no-undef；后端日志允许 console。新增跨文件 auto-import 的 util 时在此补登记。
  files: ['apps/web/server/**/*.ts', 'apps/web/*.config.ts'],
  languageOptions: {
    globals: {
      defineEventHandler: 'readonly',
      readBody: 'readonly',
      getRouterParam: 'readonly',
      getQuery: 'readonly',
      createError: 'readonly',
      toWebRequest: 'readonly',
      useRuntimeConfig: 'readonly',
      defineNuxtConfig: 'readonly',
      useAuth: 'readonly',
      presignUpload: 'readonly',
      process: 'readonly',
    },
  },
  rules: {
    'no-console': 'off',
  },
})
