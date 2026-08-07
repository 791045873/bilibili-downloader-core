import { describe, it, expect } from 'vitest'
import { BilibiliClient } from '../src/client.js'
import { BiliError } from '../src/errors.js'

interface MockResponseInit {
  status?: number
  json?: unknown
  text?: string
  setCookies?: string[]
}

function mockResponse(init: MockResponseInit): Response {
  const body = init.text !== undefined ? init.text : JSON.stringify(init.json ?? {})
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of init.setCookies ?? []) {
    headers.append('Set-Cookie', cookie)
  }
  return {
    status: init.status ?? 200,
    headers,
    ok: (init.status ?? 200) < 400,
    async text() {
      return body
    },
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer
    },
    json: async () => JSON.parse(body),
  } as unknown as Response
}

/** 路由式 mock fetch：按 url 关键字返回 */
type Route = { match: (url: string) => boolean; respond: (url: string) => Response }

function installFetch(routes: Route[]) {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    const route = routes.find((r) => r.match(url))
    if (!route) throw new Error(`no mock route for ${url}`)
    return route.respond(url)
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

describe('BilibiliClient', () => {
  it('autoInit 关闭时不做网络请求', () => {
    const mock = installFetch([])
    const client = new BilibiliClient({ autoInit: false })
    expect(mock.calls).toHaveLength(0)
    expect(client.session.sessData).toBe('')
    mock.restore()
  })

  it('autoInit 开启时异步拉取 buvid + bili_ticket', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/finger/spi'),
        respond: () => mockResponse({ json: { code: 0, message: '0', data: { b_3: 'buvid3', b_4: 'buvid4' } } }),
      },
      {
        match: (url) => url.includes('/GenWebTicket'),
        respond: () => mockResponse({ json: { code: 0, message: '0', data: { ticket: 'ticket_jwt' } } }),
      },
    ])
    const client = new BilibiliClient({ autoInit: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(client.session.buvid3).toBe('buvid3')
    expect(client.http.jar.get('bilibili.com', 'bili_ticket')).toBe('ticket_jwt')
    mock.restore()
  })

  it('Session cookieString 包含注入的登录态', () => {
    const client = new BilibiliClient({
      autoInit: false,
      session: { sessData: 'SESSDATA_VAL', biliJct: 'jct_val', dedeUserID: 123 },
    })
    const cookie = client.cookieString()
    expect(cookie).toContain('SESSDATA=SESSDATA_VAL')
    expect(cookie).toContain('bili_jct=jct_val')
    expect(cookie).toContain('DedeUserID=123')
  })

  it('LoginApi.qrPoll 成功后同步会话 cookie', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/x/passport-login/web/qrcode/poll'),
        respond: () =>
          mockResponse({
            json: {
              code: 0,
              message: '0',
              data: { url: '', refresh_token: 'rt', timestamp: 1, code: 0, message: '成功' },
            },
            setCookies: [
              'SESSDATA=sess_abc; Domain=.bilibili.com; Path=/',
              'bili_jct=jct_xyz; Domain=.bilibili.com; Path=/',
              'DedeUserID=42; Domain=.bilibili.com; Path=/',
            ],
          }),
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    const result = await client.login.qrPoll('key123')
    expect(result.code).toBe(0)
    expect(client.session.sessData).toBe('sess_abc')
    expect(client.session.biliJct).toBe('jct_xyz')
    expect(client.session.dedeUserID).toBe(42)
    mock.restore()
  })

  it('CommentApi.list 非零 code 抛出 BiliError', async () => {
    const mock = installFetch([
      {
        match: () => true,
        respond: () => mockResponse({ json: { code: -352, message: '风控校验失败', data: null } }),
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    await expect(client.comment.list({ oid: 1 })).rejects.toMatchObject({
      code: -352,
      message: '风控校验失败',
    })
    mock.restore()
  })

  it('VideoApi.view WBI v_voucher 时强制刷新 key 并重试', async () => {
    let viewCalls = 0
    let navCalls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/x/web-interface/nav'),
        respond: () => {
          navCalls++
          return mockResponse({
            json: {
              code: 0,
              message: '0',
              data: {
                wbi_img: {
                  img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                  sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
                },
              },
            },
          })
        },
      },
      {
        match: (url) => url.includes('/wbi/view'),
        respond: () => {
          viewCalls++
          // 第一次请求服务端返回 v_voucher，之后正常
          if (viewCalls === 1) {
            return mockResponse({ json: { code: 0, message: '0', data: { v_voucher: 'voucher_x' } } })
          }
          return mockResponse({ json: { code: 0, message: '0', data: { bvid: 'BV1L9Uoa9EUx', aid: 111298867365120 } } })
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    const data = await client.video.view({ aid: 111298867365120 })
    expect(data.bvid).toBe('BV1L9Uoa9EUx')
    // 第一次 v_voucher 后触发强制刷新 nav + 重试 view
    expect(viewCalls).toBe(2)
    expect(navCalls).toBe(2)
    mock.restore()
  })

  it('VideoApi.playurl 自动附加 qn/fnval/fourk', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/wbi/playurl'),
        respond: (url) => {
          expect(url).toContain('qn=120')
          expect(url).toContain('fnval=4048')
          expect(url).toContain('fourk=1')
          expect(url).toContain('w_rid=')
          return mockResponse({ json: { code: 0, message: '0', data: { quality: 120 } } })
        },
      },
      {
        match: (url) => url.includes('/web-interface/nav'),
        respond: () =>
          mockResponse({
            json: {
              code: 0,
              message: '0',
              data: {
                wbi_img: {
                  img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                  sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
                },
              },
            },
          }),
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    const data = await client.video.playurl({ cid: 123, aid: 456 })
    expect(data.quality).toBe(120)
    mock.restore()
  })

  it('api 模块均已实例化', () => {
    const client = new BilibiliClient({ autoInit: false })
    for (const name of ['login', 'video', 'user', 'comment', 'dynamic', 'search', 'favorite', 'history', 'danmaku']) {
      expect((client as unknown as Record<string, unknown>)[name]).toBeDefined()
    }
  })
})
