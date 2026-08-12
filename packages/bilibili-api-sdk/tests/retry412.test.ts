import { describe, it, expect, vi, afterEach } from 'vitest'
import { mockResponse, installFetch } from './helpers/mockFetch.js'
import { BilibiliClient } from '../src/client.js'

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

const CODE = (code: number, message: string) => mockResponse({ json: { code, message, data: null } })

/** 依次推进 4 次指数退避（base 1s，抖动 ≤250ms），最多覆盖 1s/2s/4s/8s */
async function advanceAllBackoffs() {
  await vi.advanceTimersByTimeAsync(1000 + 250)
  await vi.advanceTimersByTimeAsync(2000 + 250)
  await vi.advanceTimersByTimeAsync(4000 + 250)
  await vi.advanceTimersByTimeAsync(8000 + 250)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('-412 自动重试', () => {
  it('连续 -412 耗尽：目标端点总共 5 次请求后抛 BiliError(-412)', async () => {
    vi.useFakeTimers()
    let calls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/v2/reply/main'),
        respond: () => {
          calls++
          return CODE(-412, '请求被拦截')
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false, retry: { refreshCredentials: false } })
    const p = client.comment.list({ oid: 1 })
    const assertion = expect(p).rejects.toMatchObject({ code: -412 })
    await advanceAllBackoffs()
    await assertion
    expect(calls).toBe(5)
    mock.restore()
  })

  it('第 3 次请求成功：总请求数 3，正常返回数据', async () => {
    vi.useFakeTimers()
    let calls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/v2/reply/main'),
        respond: () => {
          calls++
          return calls >= 3 ? OK({ replies: [] }) : CODE(-412, '请求被拦截')
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false, retry: { refreshCredentials: false } })
    const p = client.comment.list({ oid: 1 })
    await vi.advanceTimersByTimeAsync(1000 + 250)
    await vi.advanceTimersByTimeAsync(2000 + 250)
    const data = await p
    expect(calls).toBe(3)
    expect(data).toEqual({ replies: [] })
    mock.restore()
  })

  it('HTTP 412 + 非 JSON body / 空 body 同样触发重试并最终成功', async () => {
    vi.useFakeTimers()
    let calls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/v2/reply/main'),
        respond: () => {
          calls++
          if (calls === 1) return mockResponse({ status: 412, text: '<html>blocked</html>' })
          if (calls === 2) return mockResponse({ status: 412, text: '' })
          return OK({ replies: [] })
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false, retry: { refreshCredentials: false } })
    const p = client.comment.list({ oid: 1 })
    await vi.advanceTimersByTimeAsync(1000 + 250)
    await vi.advanceTimersByTimeAsync(2000 + 250)
    const data = await p
    expect(calls).toBe(3)
    expect(data).toEqual({ replies: [] })
    mock.restore()
  })

  it('非 -412 业务错误不重试，直接抛出', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/v2/reply/main'),
        respond: () => CODE(-404, '啥都木有'),
      },
    ])
    const client = new BilibiliClient({ autoInit: false })
    await expect(client.comment.list({ oid: 1 })).rejects.toMatchObject({ code: -404 })
    expect(mock.calls.length).toBe(1)
    mock.restore()
  })

  it('首次 -412 后触发 buvid + bili_ticket 凭据刷新（仅一次）', async () => {
    vi.useFakeTimers()
    let viewCalls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/finger/spi'),
        respond: () => mockResponse({ json: { code: 0, message: '0', data: { b_3: 'buvid3-new', b_4: 'buvid4-new' } } }),
      },
      {
        match: (url) => url.includes('/GenWebTicket'),
        respond: () => mockResponse({ json: { code: 0, message: '0', data: { ticket: 'ticket_new' } } }),
      },
      {
        match: (url) => url.includes('/wbi/view'),
        respond: () => {
          viewCalls++
          return viewCalls >= 2 ? OK({ bvid: 'BV1L9Uoa9EUx' }) : CODE(-412, '请求被拦截')
        },
      },
      { match: (url) => url.includes('/web-interface/nav'), respond: NAV },
    ])
    const client = new BilibiliClient({ autoInit: false })
    const p = client.video.view({ bvid: 'BV1L9Uoa9EUx' })
    await vi.advanceTimersByTimeAsync(1000 + 250)
    const data = await p
    expect(data.bvid).toBe('BV1L9Uoa9EUx')
    expect(viewCalls).toBe(2)
    expect(mock.byUrl('/finger/spi')).toHaveLength(1)
    expect(mock.byUrl('/GenWebTicket')).toHaveLength(1)
    mock.restore()
  })

  it('retry.enabled=false 不重试', async () => {
    const mock = installFetch([
      {
        match: (url) => url.includes('/v2/reply/main'),
        respond: () => CODE(-412, '请求被拦截'),
      },
    ])
    const client = new BilibiliClient({ autoInit: false, retry: { enabled: false } })
    await expect(client.comment.list({ oid: 1 })).rejects.toMatchObject({ code: -412 })
    expect(mock.calls.length).toBe(1)
    mock.restore()
  })

  it('postForm 写操作同样 -412 重试', async () => {
    vi.useFakeTimers()
    let calls = 0
    const mock = installFetch([
      {
        match: (url) => url.includes('/history/clear'),
        respond: () => {
          calls++
          return CODE(-412, '请求被拦截')
        },
      },
    ])
    const client = new BilibiliClient({ autoInit: false, retry: { refreshCredentials: false } })
    const p = client.history.clear()
    const assertion = expect(p).rejects.toMatchObject({ code: -412 })
    await advanceAllBackoffs()
    await assertion
    expect(calls).toBe(5)
    mock.restore()
  })
})
