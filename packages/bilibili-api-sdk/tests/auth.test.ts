import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { mockResponse, installFetch } from './helpers/mockFetch.js'
import { BilibiliHttp } from '../src/http/http.js'
import { CookieJar } from '../src/http/cookieJar.js'
import { Session } from '../src/auth/session.js'
import { WbiKeyManager } from '../src/auth/wbi.js'
import { BiliTicketManager } from '../src/auth/biliTicket.js'
import { fetchBuvid, generateBuvid3 } from '../src/auth/buvid.js'

describe('BiliTicketManager', () => {
  it('buildHexsign 与文档算法一致', () => {
    const ts = 1700000000
    const expected = createHmac('sha256', 'XgwSnGZ1p').update(`ts${ts}`).digest('hex')
    expect(BiliTicketManager.buildHexsign(ts)).toBe(expected)
  })

  it('get 请求成功并将 ticket 写入 cookie', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/GenWebTicket'),
        respond: (url, init) => {
          expect(init?.method).toBe('POST')
          expect(init?.body).toContain('key_id=ec02')
          expect(init?.body).toContain('hexsign=')
          expect(init?.body).toContain('csrf=myjct')
          return mockResponse({ json: { code: 0, message: '0', data: { ticket: 'jwt.ticket' } } })
        },
      },
    ])
    const http = new BilibiliHttp()
    const m = new BiliTicketManager()
    const ticket = await m.get(http, 'myjct')
    expect(ticket).toBe('jwt.ticket')
    expect(http.jar.get('bilibili.com', 'bili_ticket')).toBe('jwt.ticket')
    mock.restore()
  })

  it('get 失败返回空并缓存重置', async () => {
    const mock = installFetch([
      { match: () => true, respond: () => mockResponse({ json: { code: -1, message: 'x', data: null } }) },
    ])
    const http = new BilibiliHttp()
    const m = new BiliTicketManager()
    expect(await m.get(http)).toBe('')
    m.reset()
    expect(m).toBeInstanceOf(BiliTicketManager)
    mock.restore()
  })
})

describe('buvid', () => {
  it('generateBuvid3 返回 UUID+infoc', () => {
    const v = generateBuvid3()
    expect(v).toMatch(/^[0-9a-f-]{36}infoc$/)
  })

  it('fetchBuvid 从 spi 获取', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/finger/spi'),
        respond: () => mockResponse({ json: { code: 0, message: '0', data: { b_3: 'b3', b_4: 'b4' } } }),
      },
    ])
    const http = new BilibiliHttp()
    expect(await fetchBuvid(http)).toEqual({ b_3: 'b3', b_4: 'b4' })
    mock.restore()
  })

  it('fetchBuvid 失败时本地生成', async () => {
    const mock = installFetch([
      { match: () => true, respond: () => mockResponse({ json: { code: -1, message: 'x', data: null } }) },
    ])
    const http = new BilibiliHttp()
    const { b_3 } = await fetchBuvid(http)
    expect(b_3).toMatch(/infoc$/)
    mock.restore()
  })
})

describe('Session', () => {
  it('apply 同步到 jar 并暴露 csrf/loggedIn', () => {
    const jar = new CookieJar()
    const s = new Session({ sessData: 's', biliJct: 'j', dedeUserID: 42, buvid3: 'b3', buvid4: 'b4', accessToken: 'at' }, jar)
    expect(s.loggedIn).toBe(true)
    expect(s.csrf).toBe('j')
    expect(jar.get('bilibili.com', 'SESSDATA')).toBe('s')
    expect(jar.get('bilibili.com', 'DedeUserID')).toBe('42')
    expect(jar.get('bilibili.com', 'buvid3')).toBe('b3')
    expect(jar.get('bilibili.com', 'buvid4')).toBe('b4')
    expect(s.toObject().accessToken).toBe('at')
  })

  it('clear 清空登录态并重置 buvid', () => {
    const s = new Session({ sessData: 's', biliJct: 'j' })
    expect(s.buvid3).toMatch(/infoc$/)
    s.clear()
    expect(s.sessData).toBe('')
    expect(s.biliJct).toBe('')
    expect(s.dedeUserID).toBe(0)
    expect(s.loggedIn).toBe(false)
    expect(s.buvid3).toMatch(/infoc$/)
    expect(s.jar.get('bilibili.com', 'SESSDATA')).toBeUndefined()
  })

  it('无参数构造自动生成 buvid3', () => {
    const s = new Session()
    expect(s.buvid3).toMatch(/infoc$/)
  })
})

describe('WbiKeyManager', () => {
  const NAV = () =>
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
    })

  it('getKeys 拉取并缓存（并发去重）', async () => {
    let n = 0
    const mock = installFetch([{ match: () => true, respond: () => (n++, NAV()) }])
    const http = new BilibiliHttp()
    const m = new WbiKeyManager()
    const [a, b] = await Promise.all([m.getKeys(http), m.getKeys(http)])
    expect(a.mixinKey).toBe('ea1db124af3c7062474693fa704f4ff8')
    expect(b).toBe(a)
    expect(n).toBe(1)
    mock.restore()
  })

  it('缓存有效期内不重复请求；force 强制刷新', async () => {
    let n = 0
    const mock = installFetch([{ match: () => true, respond: () => (n++, NAV()) }])
    const http = new BilibiliHttp()
    const m = new WbiKeyManager()
    await m.getKeys(http)
    await m.getKeys(http)
    expect(n).toBe(1)
    await m.getKeys(http, true)
    expect(n).toBe(2)
    mock.restore()
  })

  it('refresh 在 nav 缺少 wbi_img 时抛错', async () => {
    const mock = installFetch([{ match: () => true, respond: () => mockResponse({ json: { code: 0, data: {} } }) }])
    const http = new BilibiliHttp()
    const m = new WbiKeyManager()
    await expect(m.refresh(http)).rejects.toThrow(/wbi_img/)
    mock.restore()
  })

  it('setKeys 注入缓存；cached 读取', () => {
    const m = new WbiKeyManager()
    expect(m.cached).toBeNull()
    m.setKeys({ imgKey: '7cd084941338484aae1ad9425b84077c', subKey: '4932caff0ff746eab6f01bf08b70ac45' })
    expect(m.cached?.mixinKey).toBe('ea1db124af3c7062474693fa704f4ff8')
  })

  it('sign 附加 wts 与 w_rid', async () => {
    const mock = installFetch([{ match: () => true, respond: NAV }])
    const http = new BilibiliHttp()
    const m = new WbiKeyManager()
    const signed = await m.sign(http, { aid: 170001 })
    expect(typeof signed.wts).toBe('number')
    expect(typeof signed.w_rid).toBe('string')
    expect(signed.w_rid).toHaveLength(32)
    mock.restore()
  })

  it('extractWbiKeysFromUrl 对非法 url 抛错', async () => {
    const { extractWbiKeysFromUrl } = await import('../src/auth/wbi.js')
    expect(() => extractWbiKeysFromUrl('https://i0.hdslb.com/bfs/wbi/', 'https://i0.hdslb.com/bfs/wbi/')).toThrow()
  })
})
