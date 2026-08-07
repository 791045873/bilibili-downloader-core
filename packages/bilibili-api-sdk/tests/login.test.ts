import { describe, it, expect } from 'vitest'
import { mockResponse, installFetch, type Route } from './helpers/mockFetch.js'
import { BilibiliClient } from '../src/client.js'

const OK = (data: unknown = null) => mockResponse({ json: { code: 0, message: '0', data } })

function makeClient(routes: Route[], opts: { sessData?: string; biliJct?: string } = {}) {
  const mock = installFetch(routes)
  const client = new BilibiliClient({
    autoInit: false,
    session: { sessData: opts.sessData, biliJct: opts.biliJct },
  })
  return { client, mock }
}

describe('LoginApi', () => {
  it('qrGenerate 请求生成接口', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/qrcode/generate'),
        respond: () => OK({ url: 'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=k&from=', qrcode_key: 'k' }),
      },
    ])
    const r = await client.login.qrGenerate()
    expect(r.qrcode_key).toBe('k')
    mock.restore()
  })

  it('isLoggedIn 依据 nav 返回', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/web-interface/nav'),
        respond: () => OK({ isLogin: true, mid: 1 }),
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    expect(await client.login.isLoggedIn()).toBe(true)
    mock.restore()
  })

  it('qrLogin 轮询直至成功', async () => {
    let poll = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/qrcode/generate'),
        respond: () => OK({ url: 'u', qrcode_key: 'k' }),
      },
      {
        match: (url) => url.includes('/qrcode/poll'),
        respond: () => {
          poll++
          if (poll === 1) return OK({ url: '', refresh_token: '', timestamp: 1, code: 86101, message: '未扫码' })
          return OK({ url: '', refresh_token: 'rt', timestamp: 1, code: 0, message: '成功' })
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    const result = await client.login.qrLogin({ intervalMs: 1, timeoutMs: 1000 })
    expect(result?.code).toBe(0)
    expect(poll).toBe(2)
    mock.restore()
  })

  it('tvQrGenerate / tvQrPoll 带 APP 签名', async () => {
    const routes: Route[] = [
      {
        match: (url) => url.includes('/qrcode/auth_code'),
        respond: (url, init) => {
          expect(init?.method).toBe('POST')
          expect(init?.body).toContain('appkey=')
          expect(init?.body).toContain('sign=')
          expect(init?.body).toContain('local_id=0')
          return OK({ url: 'u', auth_code: 'ac' })
        },
      },
      {
        match: (url) => url.includes('/qrcode/poll'),
        respond: (url, init) => {
          expect(init?.body).toContain('auth_code=ac')
          expect(init?.body).toContain('sign=')
          return OK({
            code: 0,
            message: '0',
            token_info: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, mid: 1 },
          })
        },
      },
    ]
    const { client, mock } = makeClient(routes)
    const auth = await client.login.tvQrGenerate()
    expect(auth.auth_code).toBe('ac')
    const poll = await client.login.tvQrPoll(auth.auth_code)
    expect(poll.token_info?.access_token).toBe('at')
    mock.restore()
  })

  it('applyTvPollResult 写入会话', () => {
    const { client } = makeClient([])
    client.login.applyTvPollResult({
      code: 0,
      message: '0',
      token_info: { access_token: 'at', refresh_token: 'rt', expires_in: 1, mid: 1 },
      cookie_info: {
        cookies: [
          { name: 'SESSDATA', value: 'tv_sess' },
          { name: 'bili_jct', value: 'tv_jct' },
          { name: 'DedeUserID', value: '7' },
        ],
      },
    })
    expect(client.session.accessToken).toBe('at')
    expect(client.session.sessData).toBe('tv_sess')
    expect(client.session.biliJct).toBe('tv_jct')
    expect(client.session.dedeUserID).toBe(7)
  })

  it('logout 调退出接口并清空会话', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/login/exit/v2'),
        respond: (url, init) => {
          expect(init?.body).toContain('biliCSRF=myjct')
          return OK({})
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false, session: { sessData: 's', biliJct: 'myjct' } })
    await client.login.logout()
    expect(client.session.loggedIn).toBe(false)
    mock.restore()
  })
})
