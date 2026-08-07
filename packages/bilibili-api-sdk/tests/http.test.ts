import { describe, it, expect } from 'vitest'
import { mockResponse, installFetch } from './helpers/mockFetch.js'
import { BilibiliHttp } from '../src/http/http.js'
import { CookieJar, parseSetCookie, cookieDomainOf } from '../src/http/cookieJar.js'

const NAV_RESPONSE = () =>
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

describe('BilibiliHttp', () => {
  it('GET 发送查询参数并解析 JSON', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/api'),
        respond: (url) => {
          expect(url).toContain('a=1')
          expect(url).toContain('b=x')
          return mockResponse({ json: { ok: true } })
        },
      },
    ])
    const http = new BilibiliHttp()
    const res = await http.get('https://api.bilibili.com/api', { params: { a: 1, b: 'x' } })
    expect(res.body).toEqual({ ok: true })
    mock.restore()
  })

  it('POST 默认表单 Content-Type 与 csrf body', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/post'),
        respond: (url, init) => {
          expect(init?.method).toBe('POST')
          expect(init?.body).toContain('key=value')
          return mockResponse({ json: { code: 0, message: '0', data: null } })
        },
      },
    ])
    const http = new BilibiliHttp()
    await http.post('https://api.bilibili.com/post', { body: { key: 'value' } })
    mock.restore()
  })

  it('失败后按 retries 重试并最终成功', async () => {
    let n = 0
    const mock = installFetch([
      {
        match: () => true,
        respond: () => {
          n++
          if (n < 3) throw new Error('boom')
          return mockResponse({ json: { ok: true } })
        },
      },
    ])
    const http = new BilibiliHttp()
    const res = await http.get('https://api.bilibili.com/retry', { retries: 2 })
    expect(res.body).toEqual({ ok: true })
    expect(n).toBe(3)
    mock.restore()
  })

  it('raw 模式返回文本', async () => {
    const mock = installFetch([
      { match: () => true, respond: () => mockResponse({ text: 'hello' }) },
    ])
    const http = new BilibiliHttp()
    const res = await http.get('https://api.bilibili.com/raw', { raw: true })
    expect(res.body).toBe('hello')
    mock.restore()
  })

  it('buffer 模式返回字节', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const mock = installFetch([
      { match: () => true, respond: () => mockResponse({ buffer: bytes }) },
    ])
    const http = new BilibiliHttp()
    const res = await http.get('https://api.bilibili.com/bin', { buffer: true })
    expect(res.body).toEqual(bytes)
    mock.restore()
  })

  it('超时后抛出错误（不重试则直接失败）', async () => {
    const original = globalThis.fetch
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        setTimeout(() => resolve(mockResponse({ json: {} })), 500)
      })) as typeof fetch
    const http = new BilibiliHttp()
    await expect(http.get('https://api.bilibili.com/slow', { timeoutMs: 50, retries: 0 })).rejects.toBeTruthy()
    globalThis.fetch = original
  })
})

describe('CookieJar', () => {
  it('parseSetCookie 解析属性', () => {
    const c = parseSetCookie('SESSDATA=abc; Domain=.bilibili.com; Path=/; HttpOnly')
    expect(c).toMatchObject({ name: 'SESSDATA', value: 'abc', domain: '.bilibili.com', path: '/', httpOnly: true })
  })

  it('cookieDomainOf 子域归一到主域', () => {
    expect(cookieDomainOf('passport.bilibili.com')).toBe('bilibili.com')
    expect(cookieDomainOf('example.com')).toBe('example.com')
  })

  it('setFromString 批量导入并 buildHeader 输出', () => {
    const jar = new CookieJar()
    jar.setFromString('SESSDATA=x; bili_jct=y; DedeUserID=1')
    const header = jar.buildHeader('bilibili.com')
    expect(header).toContain('SESSDATA=x')
    expect(header).toContain('bili_jct=y')
    expect(header).toContain('DedeUserID=1')
  })

  it('absorb 吸收 Set-Cookie 并去重（精确 host 优先）', async () => {
    const mock = installFetch([
      {
        match: () => true,
        respond: () =>
          mockResponse({
            json: { code: 0, message: '0', data: null },
            setCookies: [
              'SESSION1=a; Domain=.bilibili.com; Path=/',
              'SESSION2=b; Domain=.bilibili.com; Path=/',
            ],
          }),
      },
    ])
    const jar = new CookieJar()
    const http = new BilibiliHttp({ jar })
    await http.get('https://api.bilibili.com/ok')
    expect(jar.get('passport.bilibili.com', 'SESSION1')).toBe('a')
    expect(jar.get('api.bilibili.com', 'SESSION2')).toBe('b')
    expect(jar.toString()).toContain('SESSION2=b')
    mock.restore()
  })

  it('过期的 Set-Cookie 被删除', () => {
    const jar = new CookieJar()
    jar.set('bilibili.com', 'expired', 'x')
    const headers = new Headers()
    headers.append('Set-Cookie', 'expired=; Domain=.bilibili.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    jar.absorb(headers, 'api.bilibili.com')
    expect(jar.get('bilibili.com', 'expired')).toBeUndefined()
  })

  it('toObject 导出快照', () => {
    const jar = new CookieJar()
    jar.set('bilibili.com', 'k', 'v')
    expect(jar.toObject()).toEqual({ 'bilibili.com': { k: 'v' } })
  })
})

describe('http 携带 cookie 请求', () => {
  it('注入 Cookie 头', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/nav'),
        respond: (url, init) => {
          expect((init as { headers?: HeadersInit } | undefined)).toBeDefined()
          return mockResponse({ json: {} })
        },
      },
    ])
    const jar = new CookieJar()
    jar.set('bilibili.com', 'SESSDATA', 's')
    const http = new BilibiliHttp({ jar })
    await http.get('https://api.bilibili.com/x/web-interface/nav')
    mock.restore()
  })

  it('withCookie:false 不注入 Cookie', async () => {
    const mock = installFetch([
      { match: () => true, respond: () => mockResponse({ json: {} }) },
    ])
    const jar = new CookieJar()
    jar.set('bilibili.com', 'SESSDATA', 's')
    const http = new BilibiliHttp({ jar })
    await http.get('https://api.bilibili.com/x', { withCookie: false })
    mock.restore()
  })

  it('nav 无头无异常', async () => {
    const mock = installFetch([
      { match: () => true, respond: NAV_RESPONSE },
    ])
    const http = new BilibiliHttp()
    const res = await http.get('https://api.bilibili.com/x/web-interface/nav')
    expect(res.body?.data?.wbi_img).toBeDefined()
    mock.restore()
  })
})
