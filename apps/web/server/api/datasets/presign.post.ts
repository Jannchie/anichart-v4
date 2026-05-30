import { randomUUID } from 'node:crypto'

// 请求一个预签名上传 URL，前端拿到后把数据文件直传对象存储。
export default defineEventHandler(async (event) => {
  const sessionData = await useAuth().api.getSession({ headers: event.headers })
  if (!sessionData?.user)
    throw createError({ statusCode: 401, statusMessage: '未登录' })

  const body = await readBody<{ filename: string, contentType?: string }>(event)
  if (!body?.filename)
    throw createError({ statusCode: 400, statusMessage: '缺少 filename' })

  const key = `datasets/${sessionData.user.id}/${randomUUID()}-${body.filename}`
  const url = await presignUpload(key, body.contentType ?? 'text/csv')
  return { key, url }
})
