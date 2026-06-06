// 封面图代理：GET /api/posters/<userId>/<workId>.png
// key 含两段不可猜的 id，按「知道 URL 即可看」处理（与 YouTube 缩略图同策略）。
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')!
  // 只允许 posters/ 前缀下的 png，防止借代理读任意对象
  if (!/^[\w-]+\/[\w-]+\.png$/.test(key)) {
    throw createError({ statusCode: 400, statusMessage: 'key 不合法' })
  }

  let bytes: Uint8Array
  try {
    bytes = await getObjectBytes(`posters/${key}`)
  }
  catch {
    throw createError({ statusCode: 404, statusMessage: '封面不存在' })
  }

  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return bytes
})
