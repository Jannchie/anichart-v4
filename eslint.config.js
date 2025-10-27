import jannchie from '@jannchie/eslint-config'

export default jannchie({
  ignores: [
    'playground/public/**',
  ],
  rules: {
    'unicorn/no-array-callback-reference': 'off',
  },
})
