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
})
