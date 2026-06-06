import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { dataset, work } from '../../db/schema'

const VISIBILITIES = new Set(['public', 'unlisted', 'private'])
// dataURL 形式的 PNG 封面，限 2MB（base64 后约 2.7M 字符）
const MAX_POSTER_CHARS = 2_800_000

interface PublishBody {
  title?: string
  description?: string
  datasetId?: string
  chartConfig?: Record<string, unknown>
  visibility?: string
  posterDataUrl?: string
}

// 解析 data:image/png;base64,... → 字节；格式不符返回 null（静默跳过封面而不是失败发布）
function decodePoster(dataUrl: string | undefined): Uint8Array | null {
  if (!dataUrl || dataUrl.length > MAX_POSTER_CHARS || !dataUrl.startsWith('data:image/png;base64,'))
    return null
  try {
    return Uint8Array.from(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
  }
  catch {
    return null
  }
}

// 发布作品：editor 完成 CSV 直传 + dataset 登记后调用。
export default defineEventHandler(async (event) => {
  const { user } = await requireSession(event)
  const body = await readBody<PublishBody>(event)

  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少标题' })
  }
  if (!body.datasetId || !body.chartConfig || typeof body.chartConfig !== 'object') {
    throw createError({ statusCode: 400, statusMessage: '缺少 datasetId 或 chartConfig' })
  }
  const visibility = VISIBILITIES.has(body.visibility ?? '') ? body.visibility! : 'public'

  const db = useDb()
  // 数据集必须归属当前用户
  const [ds] = await db.select().from(dataset)
    .where(and(eq(dataset.id, body.datasetId), eq(dataset.userId, user.id)))
    .limit(1)
  if (!ds) {
    throw createError({ statusCode: 404, statusMessage: '数据集不存在' })
  }

  const id = randomUUID()
  const title = body.title.trim().slice(0, 200)

  // 封面：服务端中转写入对象存储（小文件，省浏览器直传的 CORS/签名）
  let posterKey: string | null = null
  const poster = decodePoster(body.posterDataUrl)
  if (poster) {
    posterKey = `posters/${user.id}/${id}.png`
    await putObject(posterKey, poster, 'image/png')
  }

  // slug 撞 unique 约束时重新生成（随机后缀，重试几次足够）
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeWorkSlug(title)
    try {
      await db.insert(work).values({
        id,
        userId: user.id,
        datasetId: ds.id,
        title,
        description: body.description?.trim().slice(0, 2000) || null,
        slug,
        chartConfig: body.chartConfig,
        visibility,
        posterKey,
      })
      return { id, slug }
    }
    catch (e) {
      const code = (e as { code?: string }).code
      if (code !== '23505') // 非唯一冲突直接抛
        throw e
    }
  }
  throw createError({ statusCode: 500, statusMessage: 'slug 生成冲突，请重试' })
})
