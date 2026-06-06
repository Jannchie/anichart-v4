/* eslint-disable no-console */
// 开发种子数据：演示用户 + 公开作品，让 feed/频道/搜索一打开就有内容。
//
// 前置条件（顺序敏感）：
//   1. docker compose up -d（Postgres 4305 + MinIO 4306）
//   2. pnpm db:migrate
//   3. pnpm dev（4300，注册用户走 better-auth HTTP API）
//   4. pnpm db:seed
//
// 幂等：用户已存在则跳过注册；同 slug 作品已存在则跳过插入。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { defaultSpec } from '../../app/lib/chart-spec'
import * as schema from './schema'

process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'))

const APP_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:4300'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
})
const BUCKET = process.env.S3_BUCKET ?? 'anichart'

interface SeedUser { email: string, name: string, password: string }

const USERS: SeedUser[] = [
  { email: 'demo@anichart.dev', name: 'Jannchie', password: 'anichart-demo-1' },
  { email: 'lab@anichart.dev', name: 'DataViz Lab', password: 'anichart-demo-2' },
]

// 注册走 better-auth 的 HTTP API（要求 dev server 在跑），已存在则忽略报错。
async function ensureUser(u: SeedUser): Promise<string> {
  const existing = await db.query.user.findFirst({ where: eq(schema.user.email, u.email) })
  if (existing)
    return existing.id

  const res = await fetch(`${APP_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    // better-auth 有 CSRF Origin 校验，脚本请求需显式带上同源 Origin
    headers: { 'Content-Type': 'application/json', 'Origin': APP_URL },
    body: JSON.stringify({ email: u.email, name: u.name, password: u.password }),
  })
  if (!res.ok)
    throw new Error(`注册 ${u.email} 失败：${res.status} ${await res.text()}`)

  const created = await db.query.user.findFirst({ where: eq(schema.user.email, u.email) })
  if (!created)
    throw new Error(`注册成功但查不到用户 ${u.email}`)
  return created.id
}

// 上传一份示例 CSV 并落 dataset 行，返回 datasetId。
async function ensureDataset(userId: string, sampleFile: string): Promise<string> {
  const filePath = path.resolve(import.meta.dirname, '../../public/samples', sampleFile)
  const text = await readFile(filePath, 'utf8')
  const lines = text.trim().split('\n')
  const columns = lines[0]?.split(',').map(c => c.trim()) ?? []
  const rowCount = Math.max(lines.length - 1, 0)

  const key = `datasets/${userId}/seed-${sampleFile}`
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: text, ContentType: 'text/csv' }))

  const inserted = await db.insert(schema.dataset)
    .values({ userId, name: sampleFile, storageKey: key, columns, rowCount })
    .returning({ id: schema.dataset.id })
  return inserted[0]!.id
}

interface SeedWork {
  owner: number // USERS 下标
  sample: string
  slug: string
  title: string
  description: string
  spec: Partial<ReturnType<typeof defaultSpec>>
  views: number
  daysAgo: number
}

const llmPreset = { idField: 'model', valueField: 'rating', stepField: 'date', stepMode: 'seconds' as const, colorField: 'company' }

const WORKS: SeedWork[] = [
  { owner: 0, sample: 'sample-llm.csv', slug: 'llm-elo-ladder', title: 'LLM Elo 天梯榜 2023', description: '按公司分色的大模型 Elo 排名变化，数据来自 Chatbot Arena。', spec: { ...llmPreset, topN: 12 }, views: 1284, daysAgo: 2 },
  { owner: 0, sample: 'sample-llm.csv', slug: 'llm-top5-sprint', title: '头部模型五强争霸', description: '只看前五名的贴身缠斗，放大差异刻度。', spec: { ...llmPreset, topN: 5, valueScale: 'from-min' }, views: 873, daysAgo: 5 },
  { owner: 0, sample: 'sample-basic.csv', slug: 'basic-bar-race', title: '基础条形竞赛示例', description: '最小可用的 id · 日期 · 数值三列数据演示。', spec: { topN: 8 }, views: 412, daysAgo: 9 },
  { owner: 1, sample: 'sample-llm.csv', slug: 'llm-trend-lines', title: 'LLM 评分趋势（折线）', description: '同一份天梯数据换折线视角，看增长曲线。', spec: { ...llmPreset, kind: 'line', topN: 8 }, views: 657, daysAgo: 3 },
  { owner: 1, sample: 'sample-basic.csv', slug: 'minimal-line-demo', title: '极简折线演示', description: '折线趋势模式 + 完整时间轴。', spec: { kind: 'line', lineAxis: 'fixed' }, views: 196, daysAgo: 12 },
  { owner: 1, sample: 'sample-llm.csv', slug: 'llm-slow-motion', title: '慢动作天梯（60 秒长版）', description: '拉长总时长，适合配解说的版本。', spec: { ...llmPreset, topN: 10, totalDurationSec: 60 }, views: 95, daysAgo: 1 },
]

async function main() {
  const userIds: string[] = []
  for (const u of USERS) {
    userIds.push(await ensureUser(u))
    console.log(`✓ 用户 ${u.name}`)
  }

  // dataset 按 (owner, sample) 去重复用
  const datasetIds = new Map<string, string>()

  for (const w of WORKS) {
    const exists = await db.query.work.findFirst({ where: eq(schema.work.slug, w.slug) })
    if (exists) {
      console.log(`- 作品已存在，跳过：${w.slug}`)
      continue
    }
    const ownerId = userIds[w.owner]!
    const dsKey = `${w.owner}:${w.sample}`
    if (!datasetIds.has(dsKey))
      datasetIds.set(dsKey, await ensureDataset(ownerId, w.sample))

    const created = new Date(Date.now() - w.daysAgo * 86_400_000)
    await db.insert(schema.work).values({
      userId: ownerId,
      datasetId: datasetIds.get(dsKey)!,
      title: w.title,
      description: w.description,
      slug: w.slug,
      chartConfig: { ...defaultSpec(), ...w.spec },
      visibility: 'public',
      views: w.views,
      createdAt: created,
      updatedAt: created,
    })
    console.log(`✓ 作品 ${w.title}`)
  }

  await sql.end()
  console.log('种子数据完成')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
