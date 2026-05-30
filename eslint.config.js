import jannchie from '@jannchie/eslint-config'

export default jannchie({
  ignores: [
    '**/public/**',
    '**/dist/**',
    '**/.output/**',
    '**/.nuxt/**',
    'apps/studio/**',
    'apps/web/**',
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
})
