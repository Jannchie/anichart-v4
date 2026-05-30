import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// ───────────────────────── better-auth 核心表 ─────────────────────────
// 字段命名遵循 better-auth 的 drizzle adapter 约定，后续可用 `npx @better-auth/cli generate` 校正/扩展。

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ───────────────────────── 业务表 ─────────────────────────

// 用户上传的数据集：原始数据存对象存储，DB 只存元信息
export const dataset = pgTable('dataset', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  storageKey: text('storage_key').notNull(), // 对象存储中的 key（如 datasets/<uuid>.csv）
  columns: jsonb('columns').$type<string[]>(), // 列名，便于配置图表时选字段
  rowCount: integer('row_count'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 可视化作品：引用一个数据集 + 一份图表配置（@anichart/core 的 Config 选项），分享页据此实时播放
export const work = pgTable('work', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  datasetId: uuid('dataset_id').notNull().references(() => dataset.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  chartConfig: jsonb('chart_config').notNull(), // 序列化后的 @anichart/core ConfigOptions
  visibility: text('visibility').notNull().default('private'), // 'public' | 'unlisted' | 'private'
  posterKey: text('poster_key'), // 可选封面图 key
  views: integer('views').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// TODO(future): like / comment / 计费相关表
