// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-30',
  devtools: { enabled: true },

  // monorepo 内每个 app 用独占端口，避免与其它服务/项目的默认端口冲突
  devServer: { port: 4300 },

  css: ['~/assets/css/main.css'],

  // PIXI 实时播放器只在客户端运行，避免 SSR 时引入 WebGL/DOM
  ssr: true,

  runtimeConfig: {
    // 仅服务端可见
    databaseUrl: process.env.DATABASE_URL,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'auto',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    public: {
      // 客户端可见
      authBaseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:4300',
    },
  },
})
