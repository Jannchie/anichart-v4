/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({ tsconfigPath: './tsconfig.json', include: ['src'], exclude: ['src/__tests__/**'] }),
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
