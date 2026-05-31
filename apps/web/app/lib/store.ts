import type { ChartSpec } from './chart-spec'

// 本地优先的作品仓库：作品（数据 + 配置 + 缩略图）存浏览器 IndexedDB，
// 让整套「上传 → 配置 → 预览 → 保存 → 浏览 → 详情」闭环无需后端即可跑通。
// server/api 下的 Postgres + S3 是未来的生产持久化路径，与此并存、互不阻塞。

export interface WorkRecord {
  id: string
  slug: string
  title: string
  spec: ChartSpec // 序列化的图表配置（字段映射 + 参数）
  csvText: string // 原始 CSV 文本
  columns: string[] // 解析出的列名
  rowCount: number
  thumbnail?: string // 预览某帧截图（dataURL），用于画廊封面
  createdAt: number
  updatedAt: number
}

const DB_NAME = 'anichart'
const STORE = 'works'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | undefined

function openDb(): Promise<IDBDatabase> {
  if (!import.meta.client) {
    return Promise.reject(new Error('IndexedDB 仅在客户端可用'))
  }
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('slug', 'slug', { unique: true })
        os.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

export async function listWorks(): Promise<WorkRecord[]> {
  const all = await tx<WorkRecord[]>('readonly', s => s.getAll() as IDBRequest<WorkRecord[]>)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getWorkBySlug(slug: string): Promise<WorkRecord | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('slug').get(slug)
    req.onsuccess = () => resolve(req.result as WorkRecord | undefined)
    req.onerror = () => reject(req.error)
  })
}

export function saveWork(record: WorkRecord): Promise<unknown> {
  return tx('readwrite', s => s.put(record))
}

export function deleteWork(id: string): Promise<unknown> {
  return tx('readwrite', s => s.delete(id))
}

// 标题 → URL 友好 slug；保留中文，去掉空白/符号，加短随机后缀避免冲突。
export function makeSlug(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^\w一-龥-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 7)
  return base ? `${base}-${suffix}` : suffix
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
