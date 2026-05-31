import { randomUUID } from 'node:crypto'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
// CSV 上传允许的 MIME；其余一律归一到 text/csv，避免用户声明 text/html 等导致对象后续以可执行类型回源（存储型 XSS）。
const ALLOWED_CONTENT_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'])

// 只取 basename，剔除路径分隔符与可疑字符并限长，避免 filename 被注入到对象存储 key。
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  const cleaned = base.replaceAll(/[^\w.-]+/g, '_').replace(/^\.+/, '')
  return (cleaned || 'file').slice(0, 128)
}

// 请求一个预签名上传 URL，前端拿到后把数据文件直传对象存储。
export default defineEventHandler(async (event) => {
  const sessionData = await useAuth().api.getSession({ headers: event.headers })
  if (!sessionData?.user) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }

  const body = await readBody<{ filename?: string, contentType?: string, size?: number }>(event)
  if (!body?.filename) {
    throw createError({ statusCode: 400, statusMessage: '缺少 filename' })
  }

  const size = Number(body.size)
  if (!Number.isFinite(size) || size <= 0) {
    throw createError({ statusCode: 400, statusMessage: '缺少有效的 size' })
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `文件过大，上限 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` })
  }

  // contentType 会被签进预签名 URL，前端 PUT 必须带相同 Content-Type，故归一后回传给前端。
  const contentType = body.contentType && ALLOWED_CONTENT_TYPES.has(body.contentType)
    ? body.contentType
    : 'text/csv'

  const key = `datasets/${sessionData.user.id}/${randomUUID()}-${sanitizeFilename(body.filename)}`
  const url = await presignUpload(key, contentType)
  // 注：size 在服务端校验声明值并挡住超限请求；硬强制（content-length-range）需改用对象存储的 POST policy。
  return { key, url, contentType }
})
