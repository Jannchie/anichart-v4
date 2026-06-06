import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { dataset, work } from '../../db/schema'

const VISIBILITIES = new Set(['public', 'unlisted', 'private'])
const MAX_POSTER_CHARS = 2_800_000

interface UpdateBody {
  title?: string
  description?: string
  chartConfig?: Record<string, unknown>
  visibility?: string
  datasetId?: string
  posterDataUrl?: string
}

// 更新已发布作品（标题/描述/配置/可见性/换数据集/换封面）。
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { work: row, user } = await requireWorkOwner(event, slug)
  const body = await readBody<UpdateBody>(event)
  const db = useDb()

  const patch: Partial<typeof work.$inferInsert> = { updatedAt: new Date() }

  if (body.title !== undefined) {
    const title = body.title.trim().slice(0, 200)
    if (!title)
      throw createError({ statusCode: 400, statusMessage: '标题不能为空' })
    patch.title = title
  }
  if (body.description !== undefined)
    patch.description = body.description.trim().slice(0, 2000) || null
  if (body.chartConfig !== undefined) {
    if (typeof body.chartConfig !== 'object' || !body.chartConfig)
      throw createError({ statusCode: 400, statusMessage: 'chartConfig 不合法' })
    patch.chartConfig = body.chartConfig
  }
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.has(body.visibility))
      throw createError({ statusCode: 400, statusMessage: 'visibility 不合法' })
    patch.visibility = body.visibility
  }
  if (body.datasetId !== undefined && body.datasetId !== row.datasetId) {
    const [ds] = await db.select().from(dataset)
      .where(and(eq(dataset.id, body.datasetId), eq(dataset.userId, user.id)))
      .limit(1)
    if (!ds)
      throw createError({ statusCode: 404, statusMessage: '数据集不存在' })
    patch.datasetId = ds.id
  }

  // 换封面：覆盖写同一个 key（前端用 updatedAt 做缓存破坏）
  if (body.posterDataUrl?.startsWith('data:image/png;base64,') && body.posterDataUrl.length <= MAX_POSTER_CHARS) {
    const bytes = Uint8Array.from(Buffer.from(body.posterDataUrl.slice('data:image/png;base64,'.length), 'base64'))
    const posterKey = row.posterKey ?? `posters/${user.id}/${row.id}.png`
    await putObject(posterKey, bytes, 'image/png')
    patch.posterKey = posterKey
  }

  await db.update(work).set(patch).where(eq(work.id, row.id))
  return { id: row.id, slug: row.slug }
})
