/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    // entryRoot: 'src' 显式 strip src/ 前缀 → 输出扁平 dist/index.d.ts（vite-plugin-dts@5 默认改成保留 src/，会破坏 package.json 的 types 指向）
    dts({ tsconfigPath: './tsconfig.json', include: ['src'], exclude: ['src/__tests__/**'], entryRoot: 'src' }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // 不打包 peer / 运行时依赖，交由消费方解析（保证 pixi 单实例）
      external: ['pixi.js', 'd3', 'dayjs'],
    },
  },
  test: {
    environment: 'node',
  },
})
