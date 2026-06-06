import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // monorepo 内每个 app 用独占端口，避免与其它服务/项目的默认端口冲突
    port: 4301,
  },
})
