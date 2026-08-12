import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockResponse, installFetch, type Route } from './helpers/mockFetch.js'
import { BilibiliClient, type ClientOptions } from '../src/client.js'
import {
  MemoryCacheStore,
  FileCacheStore,
  buildCacheKey,
  identityFingerprint,
  isCacheableRequest,
} from '../src/cache/cacheStore.js'

const NAV = () =>
  mockResponse({
    json: {
      code: 0,
      message: '0',
      data: {
        isLogin: false,
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        },
      },
    },
  })

const OK = (data: unknown = null) => mockResponse({ json: { code: 0, message: '0', data } })

function makeClient(routes: Route[], cache?: ClientOptions['cache']) {
  const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
  const client = new BilibiliClient({ autoInit: false, ...(cache ? { cache } : {}) })
  return { client, mock }
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'bili-cache-'))
}

describe('buildCacheKey', () => {
  it('参数序列化与 http 层一致：123 与 "123" 同 key、key 按字母序、忽略 undefined/null', () => {
    expect(buildCacheKey('GET', 'u', { a: 1, b: 2 }, 'fp')).toBe(buildCacheKey('GET', 'u', { b: 2, a: '1' }, 'fp'))
    expect(buildCacheKey('GET', 'u', { b: 2, a: 1 }, 'fp')).toBe('GET u?a=1&b=2#fp')
    expect(buildCacheKey('GET', 'u', { a: 1, undef: undefined, nul: null }, 'fp')).toBe('GET u?a=1#fp')
  })

  it('url / method / 指纹任一不同则 key 不同', () => {
    expect(buildCacheKey('GET', 'u', { a: 1 }, 'fp')).not.toBe(buildCacheKey('POST', 'u', { a: 1 }, 'fp'))
    expect(buildCacheKey('GET', 'u', { a: 1 }, 'fp')).not.toBe(buildCacheKey('GET', 'u2', { a: 1 }, 'fp'))
    expect(buildCacheKey('GET', 'u', { a: 1 }, 'fp')).not.toBe(buildCacheKey('GET', 'u', { a: 1 }, 'fp2'))
  })
})

describe('identityFingerprint', () => {
  it('未登录固定 guest，登录态取 SESSDATA 短哈希', () => {
    expect(identityFingerprint(undefined)).toBe('guest')
    expect(identityFingerprint('')).toBe('guest')
    expect(identityFingerprint('sess-a')).toBe(identityFingerprint('sess-a'))
    expect(identityFingerprint('sess-a')).not.toBe(identityFingerprint('sess-b'))
  })
})

describe('isCacheableRequest', () => {
  it('POST / 登录模块 / history.delete / playurl / nav 均不缓存', () => {
    expect(isCacheableRequest('GET', 'https://api.bilibili.com/x/v2/reply/main')).toBe(true)
    expect(isCacheableRequest('POST', 'https://api.bilibili.com/x/v2/reply/add')).toBe(false)
    expect(isCacheableRequest('GET', 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate')).toBe(false)
    expect(isCacheableRequest('GET', 'https://api.bilibili.com/x/web-interface/history/delete')).toBe(false)
    expect(isCacheableRequest('GET', 'https://api.bilibili.com/x/player/wbi/playurl')).toBe(false)
    expect(isCacheableRequest('GET', 'https://api.bilibili.com/x/web-interface/nav')).toBe(false)
  })
})

describe('MemoryCacheStore', () => {
  it('命中、过期 miss、clear', () => {
    const store = new MemoryCacheStore()
    store.set('k', 'v', 60_000)
    expect(store.get('k')).toBe('v')
    store.set('expired', 'x', -1)
    expect(store.get('expired')).toBeUndefined()
    store.clear()
    expect(store.get('k')).toBeUndefined()
  })

  it('容量超限按插入顺序淘汰最旧', () => {
    const store = new MemoryCacheStore(2)
    store.set('a', 1, 60_000)
    store.set('b', 2, 60_000)
    store.set('c', 3, 60_000)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBe(2)
    expect(store.get('c')).toBe(3)
  })

  it('同 key 覆盖后移到最新位置', () => {
    const store = new MemoryCacheStore(2)
    store.set('a', 1, 60_000)
    store.set('b', 2, 60_000)
    store.set('a', 10, 60_000)
    store.set('c', 3, 60_000)
    expect(store.get('a')).toBe(10)
    expect(store.get('b')).toBeUndefined()
    expect(store.get('c')).toBe(3)
  })
})

describe('FileCacheStore', () => {
  it('写入后跨实例共享命中（模拟进程重启/多实例）', () => {
    const dir = tmpDir()
    try {
      const a = new FileCacheStore(dir)
      a.set('k', { v: 1 }, 60_000)
      const b = new FileCacheStore(dir)
      expect(b.get('k')).toEqual({ v: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('过期条目 miss 并删除文件', () => {
    const dir = tmpDir()
    try {
      const store = new FileCacheStore(dir)
      store.set('k', 'v', -1)
      expect(store.get('k')).toBeUndefined()
      expect(existsSync(join(dir, `${createHash('sha1').update('k').digest('hex')}.json`))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('损坏 / 版本不匹配 / key 不匹配视为 miss 并自愈删除', () => {
    const dir = tmpDir()
    try {
      const store = new FileCacheStore(dir)
      const file = join(dir, `${createHash('sha1').update('k').digest('hex')}.json`)

      writeFileSync(file, '{ not valid json', 'utf-8')
      expect(store.get('k')).toBeUndefined()
      expect(existsSync(file)).toBe(false)

      store.set('k', 'v', 60_000)
      expect(store.get('k')).toBe('v')
      writeFileSync(file, JSON.stringify({ version: 99, key: 'k', data: 'x', expiresAt: Date.now() + 60_000, createdAt: Date.now() }), 'utf-8')
      expect(store.get('k')).toBeUndefined()

      store.set('k', 'v', 60_000)
      writeFileSync(file, JSON.stringify({ version: 1, key: 'OTHER', data: 'x', expiresAt: Date.now() + 60_000, createdAt: Date.now() }), 'utf-8')
      expect(store.get('k')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clear 清空目录（含 .tmp 残留）', () => {
    const dir = tmpDir()
    try {
      const store = new FileCacheStore(dir)
      store.set('a', 1, 60_000)
      store.set('b', 2, 60_000)
      writeFileSync(join(dir, 'leftover.tmp'), 'x', 'utf-8')
      store.clear()
      expect(store.get('a')).toBeUndefined()
      expect(store.get('b')).toBeUndefined()
      expect(existsSync(join(dir, 'leftover.tmp'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('容量超限按 createdAt 淘汰最旧', async () => {
    const dir = tmpDir()
    try {
      const store = new FileCacheStore(dir, { maxEntries: 2 })
      store.set('a', 1, 60_000)
      await new Promise((r) => setTimeout(r, 5))
      store.set('b', 2, 60_000)
      await new Promise((r) => setTimeout(r, 5))
      store.set('c', 3, 60_000)
      expect(store.get('a')).toBeUndefined()
      expect(store.get('b')).toBe(2)
      expect(store.get('c')).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('目录不可写时静默降级，不抛错', () => {
    const dir = tmpDir()
    try {
      const fileAsDir = join(dir, 'not-a-dir')
      writeFileSync(fileAsDir, 'x', 'utf-8')
      const store = new FileCacheStore(fileAsDir)
      expect(() => store.set('k', 'v', 60_000)).not.toThrow()
      expect(store.get('k')).toBeUndefined()
      expect(() => store.clear()).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('客户端接口级缓存（默认开启）', () => {
  it('同参数重复调用仅发 1 次请求', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }])
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(1)
    mock.restore()
  })

  it('WBI 签名接口重复调用命中缓存（wts/w_rid 不影响 key）', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/wbi/view'), respond: () => OK({ bvid: 'BV1L9Uoa9EUx' }) }])
    const v1 = await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
    const v2 = await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
    expect(v1.bvid).toBe('BV1L9Uoa9EUx')
    expect(v2.bvid).toBe('BV1L9Uoa9EUx')
    expect(mock.byUrl('/wbi/view')).toHaveLength(1)
    mock.restore()
  })

  it('参数不同 / 123 与 "123" 同 key / 身份不同均正确分流', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }])
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 2 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)

    await client.comment.list({ oid: 3 })
    await client.comment.list({ oid: '3' as unknown as number })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(3)

    client.session.apply({ sessData: 'other-identity' })
    await client.comment.list({ oid: 3 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(4)
    mock.restore()
  })

  it('cookies 携带不同 SESSDATA 的 client 指纹隔离，不互串', async () => {
    const routes = [{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }]
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const clientA = new BilibiliClient({
      autoInit: false,
      cookies: 'SESSDATA=sessA; bili_jct=jct; DedeUserID=1',
    })
    const clientB = new BilibiliClient({
      autoInit: false,
      cookies: 'SESSDATA=sessB; bili_jct=jct; DedeUserID=2',
    })
    await clientA.comment.list({ oid: 1 })
    await clientB.comment.list({ oid: 1 })
    expect(clientA.session.sessData).toBe('sessA')
    expect(clientB.session.sessData).toBe('sessB')
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)
    mock.restore()
  })

  it('TTL 过期后重新请求', async () => {
    const { client, mock } = makeClient(
      [{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }],
      { ttlMs: 100 },
    )
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 150))
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)
    mock.restore()
  })

  it('enabled=false 全局无缓存', async () => {
    const { client, mock } = makeClient(
      [{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }],
      { enabled: false },
    )
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)
    mock.restore()
  })

  it('clearCache 后重新请求', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }])
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(1)
    client.clearCache()
    await client.comment.list({ oid: 1 })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)
    mock.restore()
  })

  it('单次调用 cache:false 关闭缓存', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/v2/reply/main'), respond: () => OK({ replies: [] }) }])
    await client.comment.list({ oid: 1 })
    await client.comment.list({ oid: 1, cache: false })
    expect(mock.byUrl('/v2/reply/main')).toHaveLength(2)
    mock.restore()
  })
})

describe('内置排除项不被缓存', () => {
  it('playurl 每次调用真实请求', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/wbi/playurl'), respond: () => OK({ quality: 120 }) }])
    await client.video.playurl({ cid: 1, aid: 2 })
    await client.video.playurl({ cid: 1, aid: 2 })
    expect(mock.byUrl('/wbi/playurl')).toHaveLength(2)
    mock.restore()
  })

  it('history.delete（GET 语义写操作）每次调用真实执行', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/history/delete'), respond: () => OK(null) }])
    await client.history.delete(123)
    await client.history.delete(123)
    expect(mock.byUrl('/history/delete')).toHaveLength(2)
    mock.restore()
  })

  it('POST 写操作（history.clear）不缓存', async () => {
    const { client, mock } = makeClient([{ match: (url) => url.includes('/history/clear'), respond: () => OK(null) }])
    await client.history.clear()
    await client.history.clear()
    expect(mock.byUrl('/history/clear')).toHaveLength(2)
    mock.restore()
  })
})

describe('磁盘缓存集成', () => {
  it('共用同目录的实例互相命中（新实例不发起请求）', async () => {
    const dir = tmpDir()
    try {
      const { client: c1, mock } = makeClient(
        [{ match: (url) => url.includes('/wbi/view'), respond: () => OK({ bvid: 'BV1L9Uoa9EUx' }) }],
        { store: new FileCacheStore(dir) },
      )
      await c1.video.view({ bvid: 'BV1L9Uoa9EUx' })
      expect(mock.byUrl('/wbi/view')).toHaveLength(1)

      const c2 = new BilibiliClient({ autoInit: false, cache: { store: new FileCacheStore(dir) } })
      const v = await c2.video.view({ bvid: 'BV1L9Uoa9EUx' })
      expect(v.bvid).toBe('BV1L9Uoa9EUx')
      expect(mock.byUrl('/wbi/view')).toHaveLength(1)
      mock.restore()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
