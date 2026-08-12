import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export const CACHE_VERSION = 1

interface CacheEntry {
  version: number
  key: string
  data: unknown
  expiresAt: number
  createdAt: number
}

/** 接口级缓存存储。store 负责 TTL 判定：过期条目在 get 时视为 miss。 */
export interface ApiCacheStore {
  get(key: string): unknown | undefined
  set(key: string, data: unknown, ttlMs: number): void
  clear(): void
}

/** 内存缓存：Map + TTL + 容量上限 + 插入顺序淘汰 */
export class MemoryCacheStore implements ApiCacheStore {
  private readonly map = new Map<string, CacheEntry>()
  private readonly maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  get(key: string): unknown | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: unknown, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, {
      version: CACHE_VERSION,
      key,
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** 磁盘缓存：每条目一个 JSON 文件（sha1 文件名），原子写，损坏自愈，容量淘汰，I/O 失败静默降级 */
export class FileCacheStore implements ApiCacheStore {
  private readonly dir: string
  private readonly maxEntries: number

  constructor(dir: string, options?: { maxEntries?: number }) {
    this.dir = dir
    this.maxEntries = options?.maxEntries ?? 500
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      // 目录创建失败静默降级，后续读写同样静默失败
    }
  }

  private filePath(key: string): string {
    return join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`)
  }

  private deleteFile(key: string): void {
    try {
      unlinkSync(this.filePath(key))
    } catch {
      // 文件不存在或删除失败，忽略
    }
  }

  get(key: string): unknown | undefined {
    let raw: string
    try {
      raw = readFileSync(this.filePath(key), 'utf-8')
    } catch {
      return undefined
    }
    let entry: CacheEntry
    try {
      entry = JSON.parse(raw) as CacheEntry
    } catch {
      this.deleteFile(key)
      return undefined
    }
    if (entry.version !== CACHE_VERSION || entry.key !== key) {
      this.deleteFile(key)
      return undefined
    }
    if (Date.now() >= entry.expiresAt) {
      this.deleteFile(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: unknown, ttlMs: number): void {
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      key,
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    }
    try {
      const file = this.filePath(key)
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
      renameSync(tmp, file)
    } catch {
      return
    }
    this.evictIfNeeded()
  }

  clear(): void {
    try {
      for (const file of readdirSync(this.dir)) {
        if (file.endsWith('.json') || file.endsWith('.tmp')) {
          try {
            unlinkSync(join(this.dir, file))
          } catch {
            // 忽略单个文件删除失败
          }
        }
      }
    } catch {
      // 目录不存在等，忽略
    }
  }

  private evictIfNeeded(): void {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      if (files.length <= this.maxEntries) return
      const aged = files.map((f) => {
        try {
          const entry = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as CacheEntry
          return { f, createdAt: entry.createdAt ?? Infinity }
        } catch {
          return { f, createdAt: Infinity }
        }
      })
      aged.sort((a, b) => a.createdAt - b.createdAt)
      while (aged.length > this.maxEntries) {
        const oldest = aged.shift()
        if (!oldest) break
        try {
          unlinkSync(join(this.dir, oldest.f))
        } catch {
          // 忽略
        }
      }
    } catch {
      // 忽略
    }
  }
}

/** 缓存 key：参数值按 http 层 String(value) 语义归一，key 排序使序列化与参数顺序无关 */
export function buildCacheKey(
  method: string,
  url: string,
  params: Record<string, string | number | undefined>,
  fingerprint: string,
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    qs.set(k, String(v))
  }
  qs.sort()
  const q = qs.toString()
  return `${method} ${url}${q ? '?' + q : ''}#${fingerprint}`
}

/** 身份指纹：登录态 SESSDATA 短哈希；未登录固定 guest */
export function identityFingerprint(sessData: string | undefined): string {
  if (!sessData) return 'guest'
  return createHash('sha1').update(sessData).digest('hex').slice(0, 12)
}

/** 内置不缓存清单：写操作（GET 语义）、播放地址（CDN 时效）、登录态探测、登录模块 */
export function isCacheableRequest(method: 'GET' | 'POST', url: string): boolean {
  if (method !== 'GET') return false
  if (url.includes('passport.bilibili.com')) return false
  if (url.includes('/history/delete')) return false
  if (url.includes('/playurl')) return false
  if (url.includes('/x/web-interface/nav')) return false
  return true
}
