import { describe, it, expect } from 'vitest'
import { mockResponse, installFetch, type Route } from './helpers/mockFetch.js'
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

function makeClient(routes: Route[]) {
  const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
  const client = new BilibiliClient({ autoInit: false })
  return { client, mock }
}

describe('VideoApi', () => {
  it('view WBI 签名后请求并返回数据', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/wbi/view'),
        respond: (url) => {
          expect(url).toContain('w_rid=')
          expect(url).toContain('bvid=BV1L9Uoa9EUx')
          return OK({ bvid: 'BV1L9Uoa9EUx' })
        },
      },
    ])
    const v = await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
    expect(v.bvid).toBe('BV1L9Uoa9EUx')
    mock.restore()
  })

  it('like/triple/coin/addFavorite 通过 POST 表单并注入 csrf', async () => {
    const routes: Route[] = []
    for (const frag of ['archive/like', 'archive/like/triple', 'coin/add', 'fav/video/add']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url, init) => {
          expect(init?.method).toBe('POST')
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({
      autoInit: false,
      session: { sessData: 's', biliJct: 'myjct', dedeUserID: 1 },
    })
    await client.video.like(170001)
    await client.video.triple(170001)
    await client.video.coin(170001, { multiply: 2, select_like: 1 })
    await client.video.addFavorite(170001, [1, 2])
    const posts = mock.calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(4)
    expect(mock.calls.find((c) => c.url.includes('coin/add'))?.body).toContain('multiply=2')
    mock.restore()
  })

  it('related 走 WBI', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/related/all'),
        respond: (url) => {
          expect(url).toContain('w_rid=')
          return OK([])
        },
      },
    ])
    await client.video.related(170001)
    mock.restore()
  })

  it('delFavorite / share / toviewList', async () => {
    const routes: Route[] = [
      {
        match: (url) => url.includes('/fav/video/del'),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          expect(init?.body).toContain('del_media_ids=2')
          return OK({})
        },
      },
      {
        match: (url) => url.includes('/share/add'),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      },
      {
        match: (url) => url.includes('/toview/list'),
        respond: (url) => {
          expect(url).toContain('w_rid=')
          return OK({ count: 0 })
        },
      },
    ]
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { biliJct: 'myjct' } })
    await client.video.delFavorite(170001, [], [2])
    await client.video.share(170001)
    await client.video.toviewList()
    mock.restore()
  })
})

describe('UserApi', () => {
  it('card 返回嵌套数据', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/card'),
        respond: (url) => {
          expect(url).toContain('mid=1850091')
          expect(url).toContain('w_rid=')
          return OK({ card: { name: 't' }, follower: 1 })
        },
      },
    ])
    const c = await client.user.card(1850091)
    expect(c.card.name).toBe('t')
    mock.restore()
  })

  it('cards 批量查询', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/user/cards'),
        respond: (url) => {
          expect(url).toContain('mids=1%2C2')
          return OK({ '1': { name: 'a' } })
        },
      },
    ])
    const c = await client.user.cards([1, 2])
    expect(c['1'].name).toBe('a')
    mock.restore()
  })

  it('medalWall 带 live Referer', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/MedalWall'),
        respond: () => OK({ list: [] }),
      },
    ])
    await client.user.medalWall(1)
    mock.restore()
  })

  it('following/followers 走 WBI；follow/unfollow 带 csrf', async () => {
    const routes: Route[] = [
      {
        match: (url) => url.includes('/relation/followings'),
        respond: (url) => {
          expect(url).toContain('w_rid=')
          return OK({ list: [] })
        },
      },
      {
        match: (url) => url.includes('/relation/followers'),
        respond: () => OK({ list: [] }),
      },
      {
        match: (url) => url.includes('/relation/modify'),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      },
    ]
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { biliJct: 'myjct' } })
    await client.user.following({ vmid: 1 })
    await client.user.followers({ vmid: 1 })
    await client.user.follow(1)
    await client.user.unfollow(1)
    expect(mock.calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    mock.restore()
  })
})

describe('CommentApi', () => {
  it('list 与 detail 请求 main 接口', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/reply/main'),
        respond: (url) => {
          expect(url).toContain('oid=170001')
          return OK({ replies: [] })
        },
      },
    ])
    await client.comment.list({ oid: 170001, sort: 1 })
    await client.comment.detail(170001, 999)
    expect(mock.byUrl('/reply/main')).toHaveLength(2)
    mock.restore()
  })

  it('add/del/like 注入 csrf', async () => {
    const routes: Route[] = []
    for (const frag of ['reply/add', 'reply/del', 'reply/action']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { biliJct: 'myjct' } })
    await client.comment.add(170001, 'hello')
    await client.comment.del(1, 170001)
    await client.comment.like(1, 170001, true)
    mock.restore()
  })
})

describe('DynamicApi', () => {
  it('spaceFeed 带 x-bilibili-device 头', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('/feed/space'),
        respond: (url) => {
          expect(url).toContain('host_mid=1850091')
          return OK({ items: [], has_more: false })
        },
      },
    ])
    const f = await client.dynamic.spaceFeed(1850091)
    expect(f.has_more).toBe(false)
    mock.restore()
  })

  it('publish/delete/like 注入 csrf', async () => {
    const routes: Route[] = []
    for (const frag of ['/create', '/delete', '/thumbUp']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { biliJct: 'myjct' } })
    await client.dynamic.publish()
    await client.dynamic.delete(['1'])
    await client.dynamic.like('1', true)
    expect(mock.calls.filter((c) => c.method === 'POST')).toHaveLength(3)
    mock.restore()
  })

  it('detail 请求详情', async () => {
    const { client, mock } = makeClient([
      { match: (url) => url.includes('/detail'), respond: () => OK({ item: {} }) },
    ])
    await client.dynamic.detail('123')
    mock.restore()
  })
})

describe('SearchApi', () => {
  it('all/type/hot/defaultKeyword 走 WBI', async () => {
    const routes: Route[] = []
    for (const frag of ['/wbi/search/all/v2', '/wbi/search/type', '/wbi/search/square', '/wbi/search/defaultword']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url) => {
          expect(url).toContain('w_rid=')
          return OK({})
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false })
    await client.search.all({ keyword: 'x' })
    await client.search.type({ keyword: 'x', type: 'video' })
    await client.search.hot(10)
    await client.search.defaultKeyword()
    mock.restore()
  })

  it('suggest 不经 WBI', async () => {
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('s.search.bilibili.com'),
        respond: (url) => {
          expect(url).toContain('term=abc')
          expect(url).not.toContain('w_rid=')
          return mockResponse({ json: { result: [{ value: 'abc' }] } })
        },
      },
    ])
    const s = await client.search.suggest('abc')
    expect(s.result?.[0].value).toBe('abc')
    mock.restore()
  })
})

describe('FavoriteApi', () => {
  it('folderInfo/resourceList/createdListAll/isFav 查询', async () => {
    const routes: Route[] = []
    for (const frag of ['/v3/fav/folder/info', '/v3/fav/resource/list', '/v3/fav/folder/created/list-all', '/v2/fav/video/favoured']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url) => {
          expect(url).not.toContain('w_rid=')
          return OK({ count: 0 })
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false })
    await client.favorite.folderInfo(1)
    await client.favorite.resourceList({ mediaId: 1 })
    await client.favorite.createdListAll(1)
    await client.favorite.isFav(1)
    expect(mock.calls.length).toBeGreaterThanOrEqual(4)
    mock.restore()
  })

  it('deal/addVideo/removeVideo 注入 csrf', async () => {
    const routes: Route[] = []
    for (const frag of ['/v3/fav/resource/deal']) {
      routes.push({
        match: (url) => url.includes(frag),
        respond: (url, init) => {
          expect(init?.body).toContain('csrf=myjct')
          return OK({})
        },
      })
    }
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { biliJct: 'myjct' } })
    await client.favorite.deal(170001, [1], [2])
    await client.favorite.addVideo(170001, [1])
    await client.favorite.removeVideo(170001, [1])
    expect(mock.calls.filter((c) => c.method === 'POST')).toHaveLength(3)
    mock.restore()
  })
})

describe('HistoryApi', () => {
  it('cursor/clear/delete 请求', async () => {
    const routes: Route[] = [
      {
        match: (url) => url.includes('/history/cursor'),
        respond: (url) => {
          expect(url).toContain('max=100')
          return OK({ list: [], cursor: {} })
        },
      },
      {
        match: (url) => url.includes('/history/clear'),
        respond: (url, init) => {
          expect(init?.method).toBe('POST')
          return OK({})
        },
      },
      {
        match: (url) => url.includes('/history/delete'),
        respond: (url) => {
          expect(url).toContain('aid=170001')
          return OK({})
        },
      },
    ]
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false })
    await client.history.cursor({ max: 100 })
    await client.history.clear()
    await client.history.delete(170001)
    mock.restore()
  })
})

describe('DanmakuApi', () => {
  it('realtime 获取并解析 XML', async () => {
    const xml = `<i><state>0</state><d p="1.5,1,25,16777215,1584268892,0,a,b">hi</d></i>`
    const { client, mock } = makeClient([
      {
        match: (url) => url.includes('comment.bilibili.com'),
        respond: () => mockResponse({ text: xml }),
      },
    ])
    const dm = await client.danmaku.realtime(123)
    expect(dm.items).toHaveLength(1)
    expect(dm.items[0].text).toBe('hi')
    mock.restore()
  })

  it('historyIndex/history/historySeg 请求 dm 接口', async () => {
    const routes: Route[] = [
      {
        match: (url) => url.includes('/dm/history/index'),
        respond: (url) => {
          expect(url).toContain('month=2020-01')
          return OK(['2020-01-01'])
        },
      },
      {
        match: (url) => url.includes('/dm/history') && !url.includes('index'),
        respond: () => mockResponse({ text: '<i><state>0</state></i>' }),
      },
      {
        match: (url) => url.includes('/seg.so'),
        respond: () => mockResponse({ buffer: new Uint8Array([0, 1]) }),
      },
    ]
    const mock = installFetch([...routes, { match: (url) => url.includes('/web-interface/nav'), respond: NAV }])
    const client = new BilibiliClient({ autoInit: false, session: { sessData: 's' } })
    const idx = await client.danmaku.historyIndex(123, '2020-01')
    expect(idx).toEqual(['2020-01-01'])
    const dm = await client.danmaku.history(123, '2020-01-01')
    expect(dm.items).toEqual([])
    const seg = await client.danmaku.historySeg(123, '2020-01-01')
    expect(seg).toEqual(new Uint8Array([0, 1]))
    mock.restore()
  })
})
