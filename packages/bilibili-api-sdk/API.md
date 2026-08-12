# bilibili-api-sdk API 参考文档

> 适用于非官方 Bilibili REST API TypeScript SDK。所有接口均返回 `Promise`，业务失败（`code !== 0`）时抛出 [`BiliError`](#4-错误处理)。
>
> ⚠️ 接口可能随 B 站风控策略变化而失效，请遵守 CC-BY-NC-4.0 协议，勿用于商业用途或滥用接口。

## 目录

1. [安装与导入](#1-安装与导入)
2. [BilibiliClient 客户端](#2-bilibiliclient-客户端)
3. [会话与持久化](#3-会话与持久化)
4. [错误处理](#4-错误处理)
5. [login — 登录 / 会话](#5-login--登录--会话)
6. [video — 视频](#6-video--视频)
7. [user — 用户](#7-user--用户)
8. [comment — 评论](#8-comment--评论)
9. [dynamic — 动态](#9-dynamic--动态)
10. [search — 搜索](#10-search--搜索)
11. [favorite — 收藏夹](#11-favorite--收藏夹)
12. [history — 历史记录](#12-history--历史记录)
13. [danmaku — 弹幕](#13-danmaku--弹幕)
14. [枚举与常量速查](#14-枚举与常量速查)
15. [鉴权链路说明](#15-鉴权链路说明)

鉴权标记说明：

| 标记 | 含义 |
| --- | --- |
| 公开 | 无需登录，游客即可调用 |
| WBI | SDK 自动完成 WBI 签名（无需手动处理） |
| Cookie | 需要登录态（`SESSDATA`） |
| csrf | 需要登录态，SDK 自动注入 `csrf`（`bili_jct`） |

---

## 1. 安装与导入

```bash
# 通过 GitHub Release 的 tgz 安装指定版本
npm install https://github.com/<owner>/bilibili-api-sdk/releases/download/v0.1.0/bilibili-api-sdk-0.1.0.tgz
```

```ts
// ESM（包仅提供 ESM 入口，要求 Node >= 18）
import { BilibiliClient, BiliError } from 'bilibili-api-sdk'
```

包内全部导出见 `dist/index.d.ts`，包括：`BilibiliClient`、`BiliError`、各 API 类（`LoginApi`、`VideoApi` 等）、鉴权工具（`signWbi`、`appSign`、`fetchBuvid` 等）、HTTP 层（`BilibiliHttp`、`CookieJar`）与弹幕解析工具（`parseDanmakuXml`、`decodeInflate`）。

---

## 2. BilibiliClient 客户端

```ts
const client = new BilibiliClient(options?: ClientOptions)
```

### ClientOptions

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `userAgent` | `string` | 内置 UA | 自定义 User-Agent |
| `cookies` | `string` | - | 预置 Cookie 字符串（如从浏览器导出：`'SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx'`） |
| `session` | `object` | - | 预置会话字段，**优先于 `cookies`**，见下表 |
| `autoInit` | `boolean` | `true` | 是否自动异步初始化 `buvid` / `bili_ticket`（失败不影响主流程） |
| `cache` | `object` | 开启 | 接口级缓存配置，见[接口级缓存](#接口级缓存) |
| `retry` | `object` | 开启 | 业务错误码自动重试配置，见[自动重试](#自动重试) |

`session` 字段：`sessData`、`biliJct`、`dedeUserID`、`accessToken`、`buvid3`、`buvid4`。

### 实例成员

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `client.login` | `LoginApi` | 登录 / 会话 |
| `client.video` | `VideoApi` | 视频 |
| `client.user` | `UserApi` | 用户 |
| `client.comment` | `CommentApi` | 评论 |
| `client.dynamic` | `DynamicApi` | 动态 |
| `client.search` | `SearchApi` | 搜索 |
| `client.favorite` | `FavoriteApi` | 收藏夹 |
| `client.history` | `HistoryApi` | 历史记录 |
| `client.danmaku` | `DanmakuApi` | 弹幕 |
| `client.session` | `Session` | 会话状态（登录态、csrf、buvid） |
| `client.http` | `BilibiliHttp` | 底层 HTTP 封装（高级用法） |
| `client.wbi` | `WbiKeyManager` | WBI key 管理（自动） |

### client.clearCache(): void

清空全部接口缓存（内存或磁盘）。身份切换或需要强制 fresh 数据时调用。

### client.cookieString(): string

返回当前会话的 Cookie 字符串，用于持久化保存（见[会话与持久化](#3-会话与持久化)）。

### 多账号

每个 `BilibiliClient` 持有独立的 `Session` 与 `CookieJar`，直接 new 多个实例即可并发管理多账号。

### 接口级缓存

默认开启：同一接口（相同 URL + 参数 + 登录身份）在 TTL（默认 24h）内复用缓存，不再请求 B 站。仅缓存 GET 读接口的成功响应（`code === 0`）。

**不缓存清单（内置，不可通过配置放开）**：

- 全部写操作（含 GET 语义的 `history.delete`）
- `playurl`（UGC/PGC，CDN 地址带时效）
- 登录态探测（nav）与 login 模块全部
- 弹幕 buffer 接口、`search.suggest` 等绕过 `BaseApi.request` 的接口

```ts
new BilibiliClient({
  cache: {
    enabled: true,              // 默认 true
    ttlMs: 24 * 60 * 60 * 1000, // 默认 24h
    maxEntries: 500,            // 内存/磁盘容量上限
    store: new FileCacheStore('/path/to/cache'), // 磁盘持久化；默认内存
  },
})

// 单次调用控制（内置排除项不可开启缓存）
await client.comment.list({ oid: 1, cache: false })
await client.video.view({ bvid: 'x', cache: { ttlMs: 60_000 } })
```

| 存储实现 | 说明 |
| --- | --- |
| `MemoryCacheStore` | 默认。per-client 内存 `Map`，跨实例不共享，进程重启清空 |
| `FileCacheStore(dir, { maxEntries })` | 磁盘持久化。每条目一个 JSON 文件（`sha1(key).json`），原子写、损坏自愈、容量淘汰；同目录多实例共享，跨进程重启保留 |

缓存 I/O 失败（读损坏、写失败）静默降级，不影响接口调用主流程。

### 自动重试

默认开启：业务错误码（默认 `-412`，含 HTTP 412 全形态）自动重试，指数退避（约 1s/2s/4s/8s + 0~250ms 抖动），**总共最多 5 次请求**（`maxRetries` 默认 4），仍失败抛 `BiliError`。首次重试前自动刷新 buvid + bili_ticket。

```ts
new BilibiliClient({
  retry: {
    enabled: true,            // 默认 true
    maxRetries: 4,            // 总共 maxRetries+1 次请求
    baseDelayMs: 1000,        // 退避基数
    codes: [-412],            // 触发重试的错误码
    refreshCredentials: true, // 首次重试前刷新 buvid/bili_ticket
  },
})
```

覆盖范围：`BaseApi.request` 与 `postForm`。`bangumi/cheese.playurl`、`search.suggest`、弹幕 buffer、login 模块等绕过 `BaseApi.request` 的接口不覆盖。

---

## 3. 会话与持久化

```ts
// 1. 扫码登录后保存会话
const cookie = client.cookieString()
await fs.promises.writeFile('session.txt', cookie)

// 2. 下次启动时恢复
const client2 = new BilibiliClient({
  cookies: await fs.promises.readFile('session.txt', 'utf8'),
})

// 3. 校验登录态是否仍有效
if (!(await client2.login.isLoggedIn())) {
  // 重新走扫码流程
}
```

也可以直接操作 `client.session`：

```ts
client.session.apply({ sessData: 'xxx', biliJct: 'xxx', dedeUserID: 123 })
client.session.toObject()   // 序列化全部会话字段
client.session.csrf         // 当前 csrf（bili_jct）
client.session.loggedIn     // 是否已有 SESSDATA
client.session.clear()      // 清除会话
```

---

## 4. 错误处理

所有业务失败抛出 `BiliError`（继承 `Error`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | `number` | B 站接口返回的错误码 |
| `message` | `string` | 错误描述 |
| `raw` | `object \| null` | 原始完整响应体，便于排查 |

```ts
import { BiliError } from 'bilibili-api-sdk'

try {
  await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
} catch (err) {
  if (err instanceof BiliError) {
    console.error(`B站错误 [${err.code}]: ${err.message}`, err.raw)
    if (err.code === -101) { /* 未登录 */ }
    if (err.code === -412) { /* 风控拦截，检查 buvid/cookie 或降低频率 */ }
  }
}
```

常见错误码（完整映射见 SDK 导出 `BILI_ERROR_MESSAGES`）：

| code | 含义 |
| --- | --- |
| `-101` | 账号未登录 |
| `-103` / `-111` | csrf 校验失败 |
| `-104` | 账号异常 |
| `-352` | 风控校验失败 |
| `-400` | 请求错误（参数问题） |
| `-403` | 访问权限不足 |
| `-404` | 资源不存在 |
| `-412` | 请求被拦截（风控，检查 buvid3/cookie） |
| `-799` | 请求过于频繁 |

---

## 5. login — 登录 / 会话

### login.nav(): Promise<NavInfo>

获取导航栏信息（含登录状态与 WBI key）。**未登录不抛错**，返回 `isLogin: false`。已登录时会同步 `dedeUserID` 到会话。

```ts
const nav = await client.login.nav()
console.log(nav.isLogin, nav.uname, nav.mid, nav.money)
```

### login.isLoggedIn(): Promise<boolean>

是否已登录（内部调用 `nav()`）。

### login.qrGenerate(): Promise<QrGenerateResult>

申请 Web 登录二维码。返回 `{ url, qrcode_key }`，将 `url` 用任意二维码库（如 `qrcode`）渲染给用户扫描。

### login.qrPoll(qrcodeKey: string): Promise<QrPollResult>

轮询扫码结果。登录成功时（`code === 0`）Cookie 已自动写入会话。

`code` 语义：

| code | 含义 |
| --- | --- |
| `0` | 登录成功 |
| `86101` | 未扫码 |
| `86090` | 已扫码未确认 |
| `86038` | 二维码已失效 |

```ts
const { url, qrcode_key } = await client.login.qrGenerate()
// 渲染 url 为二维码...
while (true) {
  const r = await client.login.qrPoll(qrcode_key)
  if (r.code === 0) break            // 登录成功
  await new Promise(r => setTimeout(r, 2000))
}
```

### login.qrLogin(options?): Promise<QrPollResult | null>

便捷方法：完整扫码流程（生成二维码 → 轮询直到成功）。二维码失效时抛 `BiliError(86038)`，超时返回 `null`。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `options.intervalMs` | `number` | `2000` | 轮询间隔（毫秒） |
| `options.timeoutMs` | `number` | `180000` | 总超时（毫秒） |

> 注意：该方法内部自行生成二维码，如需把 `url` 展示给用户，请使用 `qrGenerate` + `qrPoll` 手动轮询。

### login.tvQrGenerate(): Promise<TvAuthCodeResult>

TV 端二维码 auth_code（APP 签名，自动处理）。返回 `{ url, auth_code }`。

### login.tvQrPoll(authCode: string): Promise<TvPollResult>

轮询 TV 扫码结果，成功时返回 `access_token` 与 cookie 信息。**不会自动写入会话**，需调用下一个方法。

### login.applyTvPollResult(result: TvPollResult): void

将 `tvQrPoll` 的成功结果（`access_token`、`SESSDATA`、`bili_jct`、`DedeUserID`）写入会话。

```ts
const { url, auth_code } = await client.login.tvQrGenerate()
// 渲染 url ...
const result = await client.login.tvQrPoll(auth_code) // 轮询直到 code === 0
client.login.applyTvPollResult(result)
```

### login.logout(): Promise<void>

注销登录：请求 B 站登出接口并清除本地会话（无论远端是否成功都会清除）。

---

## 6. video — 视频

### video.view(params): Promise<VideoDetail>

视频详情。**WBI 签名**，公开。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `aid` | `number` | 二选一 | AV 号 |
| `bvid` | `string` | 二选一 | BV 号 |

返回 `VideoDetail`，关键字段：`aid` / `bvid` / `cid`（首个分 P）/ `title` / `desc` / `pic` / `duration` / `owner{mid,name,face}` / `stat{view,danmaku,reply,favorite,coin,share,like}` / `pages[]`（全部分 P，各含 `cid`）。

```ts
const video = await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
console.log(video.title, video.stat.view, video.cid)
```

### video.playurl(params): Promise<PlayUrlData>

获取播放地址。**WBI 签名**；默认请求 4K + DASH 全格式。

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `cid` | `number` | 是 | - | 分 P cid（来自 `view().cid` 或 `pages[]`） |
| `bvid` / `aid` | - | 二选一 | - | 视频标识 |
| `qn` | `number` | 否 | `120`（4K） | 清晰度，见 [VideoQuality](#14-枚举与常量速查) |
| `fnval` | `number` | 否 | `4048` | 流格式位标志，见 `FnVal` |
| `fourk` | `number` | 否 | `1` | 允许 4K |

返回 `PlayUrlData`：`dash.video[]` / `dash.audio[]`（各含 `baseUrl`/`codecs`/`bandwidth` 等）、`accept_quality[]`、`support_formats[]`。高清晰度（1080P+）通常需要登录 Cookie，大会员专属清晰度需要对应账号。

```ts
const play = await client.video.playurl({ bvid: video.bvid, cid: video.cid })
const bestVideo = play.dash.video[0]
const bestAudio = play.dash.audio?.[0]
// 用 ffmpeg 等工具合并音视频流下载
```

### video.like(aid: number, like = true): Promise<VideoActionResult>

点赞（`true`）/ 取消点赞（`false`）。csrf，需登录。

### video.triple(aid: number): Promise<VideoActionResult>

一键三连（点赞 + 投币 + 收藏）。csrf，需登录。

### video.coin(aid: number, params?): Promise<unknown>

投币。csrf，需登录。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `params.multiply` | `number` | `1` | 投币数（1~2） |
| `params.select_like` | `number` | `0` | 是否同时点赞（0/1） |

### video.addFavorite(aid: number, addFavIds: number[], delFavIds = []): Promise<unknown>

将视频加入收藏夹（可同时从其他收藏夹移除）。csrf，需登录。`addFavIds` 为收藏夹 id（来自 `favorite.createdListAll()`）。

### video.delFavorite(aid: number, addFavIds = [], delFavIds: number[]): Promise<unknown>

将视频从收藏夹移除。csrf，需登录。

### video.share(aid: number): Promise<VideoActionResult>

上报分享。csrf。

### video.related(aid: number): Promise<VideoDetail[]>

相关推荐视频列表。**WBI 签名**，公开。

### video.toviewList(): Promise<{ count: number; list: unknown[] }>

稍后再看列表。**WBI 签名**，需登录。

---

## 7. user — 用户

### user.nav(): Promise<NavInfo>

导航栏信息（同 `login.nav()`，但不写入 `dedeUserID`）。未登录返回 `isLogin: false` 不抛错。

### user.card(mid: number): Promise<CardResult>

用户卡片（等级 / 粉丝 / 关注数等）。**WBI 签名**，公开。

返回 `CardResult`：`card{mid,name,sign,fans,level_info,vip,official_verify,...}`、`following`、`archive_count`、`article_count`、`follower`、`like_num`。

```ts
const card = await client.user.card(2)
console.log(card.card.name, card.card.fans)
```

### user.cards(mids: number[]): Promise<Record<string, UserCardBrief>>

批量获取用户简要信息，**最多 20 个 mid**。公开。返回 `mid → { mid, face, name, official, vip }` 的映射。

### user.medalWall(targetId: number): Promise<MedalWall>

粉丝勋章墙。公开（直播域接口）。

### user.following(params): Promise<RelationList>

关注列表。**WBI 签名，需登录**（仅能查看自己的完整列表）。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `vmid` | `number` | 是 | 目标用户 mid |
| `ps` | `number` | 否 | 每页数量 |
| `pn` | `number` | 否 | 页码 |
| `order` | `'desc' \| 'asc'` | 否 | 排序 |

返回 `{ list: RelationUser[], total }`。

### user.followers(params): Promise<RelationList>

粉丝列表。参数同 `following`。**WBI 签名，需登录**。

### user.follow(mid: number, mode = 2): Promise<unknown>

关注用户。csrf，需登录。`mode`：`2` 普通关注 / `3` 悄悄关注（取值见 `RelationAttr`）。

### user.unfollow(mid: number): Promise<unknown>

取消关注。csrf，需登录。

---

## 8. comment — 评论

### comment.list(params): Promise<ReplyList>

评论列表。公开。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `oid` | `number` | 是 | 目标 id（视频为 `aid`） |
| `type` | `CommentType` | 否 | 评论区类型，默认需显式传；视频为 `CommentType.VIDEO`(1) |
| `pn` | `number` | 否 | 页码 |
| `ps` | `number` | 否 | 每页数量 |
| `sort` | `CommentSort` | 否 | `0` 按时间 / `1` 按热度 / `2` 按点赞 |

返回 `ReplyList`：`replies[]`（含 `rpid`、`member.uname`、`content.message`、`like`、`rcount` 子回复数等）、`page{count,num,size}`、`top_replies`。

```ts
import { CommentType, CommentSort } from 'bilibili-api-sdk'

const replies = await client.comment.list({
  oid: video.aid,
  type: CommentType.VIDEO,
  sort: CommentSort.BY_HOT,
  pn: 1, ps: 20,
})
console.log(replies.replies?.[0].content.message)
```

### comment.detail(oid: number, rpid: number, type = CommentType.VIDEO): Promise<ReplyList>

拉取某条评论的子回复详情。公开。

### comment.add(oid: number, message: string, type = CommentType.VIDEO, root?: number): Promise<ReplyAddResult>

发表评论。csrf，需登录。传 `root`（根评论 rpid）则为回复评论。返回 `{ rpid, rpid_str }`。

```ts
await client.comment.add(video.aid, '前排！')                       // 主评论
await client.comment.add(video.aid, '+1', CommentType.VIDEO, rpid)  // 回复
```

### comment.del(rpid: number, oid: number, type = CommentType.VIDEO): Promise<unknown>

删除评论。csrf，需登录且仅限本人评论。

### comment.like(rpid: number, oid: number, like: boolean, type = CommentType.VIDEO): Promise<ReplyActionResult>

点赞 / 取消点赞评论。csrf，需登录。

---

## 9. dynamic — 动态

### dynamic.spaceFeed(hostMid: number, options?): Promise<SpaceDynamicFeed>

他人空间动态流。公开。分页用游标 `offset`。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `options.offset` | `string` | - | 上一页返回的 `offset` |
| `options.timezoneOffset` | `number` | `-480` | 时区偏移（分钟） |

返回 `{ items: DynamicItem[], offset, has_more }`。`DynamicItem` 关键字段：`id_str`、`type`、`modules.module_author{name,mid,pub_ts}`、`modules.module_dynamic{desc,major}`、`modules.module_stat{comment,like,forward}`。

```ts
let offset: string | undefined
do {
  const feed = await client.dynamic.spaceFeed(672328094, { offset })
  for (const item of feed.items) console.log(item.id_str, item.type)
  offset = feed.offset
} while (offset)
```

### dynamic.detail(id: string): Promise<DynamicDetail>

动态详情。公开。`id` 为动态 id 字符串（`id_str`）。

### dynamic.publish(dynSrc?): Promise<PublishDynamicResult>

发布纯文本动态。csrf，需登录。返回 `{ dynamic_id_str }`。

### dynamic.delete(dynIds: string[]): Promise<DynamicActionResult>

批量删除动态。csrf，需登录。

### dynamic.like(dynId: string, like: boolean): Promise<DynamicActionResult>

点赞 / 取消点赞动态。csrf，需登录。

---

## 10. search — 搜索

### search.all(params): Promise<SearchAllResult>

综合搜索（全类型）。**WBI 签名**，公开。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | `string` | 是 | 关键词 |
| `page` | `number` | 否 | 页码 |
| `pageSize` | `number` | 否 | 每页数量 |

返回 `SearchAllResult`：`numResults` / `numPages` / `video.result[]`（`SearchVideoItem`：`bvid`、`title`、`author`、`play`、`pubdate`、`duration` 等）/ `bili_user` / `live_room` 等各类型结果。

```ts
const res = await client.search.all({ keyword: 'typescript 教程', page: 1 })
console.log(res.video?.result.map(v => `${v.title} (${v.bvid})`))
```

### search.type(params): Promise<SearchTypeResult>

按类型搜索。**WBI 签名**，公开。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | `string` | 是 | 关键词 |
| `type` | `SearchType` | 是 | 类型枚举，见下 |
| `page` / `pageSize` | `number` | 否 | 分页 |
| `order` | `SearchOrder` | 否 | 排序方式 |

`SearchType`：`VIDEO` / `USER`(`bili_user`) / `LIVE_ROOM` / `LIVE_USER` / `BANGUMI` / `FILM` / `PGC` / `ARTICLE`。
`SearchOrder`：`TOTAL_RANK`(综合) / `CLICK`(最多播放) / `PUBDATE`(最新发布) / `DM`(最多弹幕) / `SCORES`(最多收藏)。

```ts
const res = await client.search.type({
  keyword: '美食',
  type: SearchType.VIDEO,
  order: SearchOrder.CLICK,
  page: 1,
})
```

### search.hot(limit = 20): Promise<{ trending: { list: HotWordItem[] } }>

热搜词。**WBI 签名**，公开。`HotWordItem`：`keyword`、`show_name`、`icon`、`word_type`。

### search.suggest(term: string): Promise<SuggestResult>

搜索建议。公开，无需 WBI。返回 `{ result?: SuggestItem[] }`，每项含 `value` / `name` / `type`。

### search.defaultKeyword(): Promise<{ trackid?; word?; id? }>

默认搜索词（搜索框轮换词）。**WBI 签名**，公开。

---

## 11. favorite — 收藏夹

### favorite.folderInfo(mediaId: number, upMid?): Promise<FavFolder>

收藏夹详情。公开。返回 `{ id, title, media_count, upper, attr, ... }`。

### favorite.resourceList(params): Promise<FavResourceList>

收藏夹内容列表。公开（私密收藏夹需本人登录）。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mediaId` | `number` | 是 | 收藏夹 id |
| `pn` / `ps` | `number` | 否 | 分页 |
| `order` | `FavOrder` | 否 | `mtime`(最近收藏) / `view`(最多播放) / `pubtime`(最新投稿) |
| `type` | `number` | 否 | 资源类型，视频为 2（默认） |

返回 `{ count, has_more, info, medias[] }`。`FavMedia` 关键字段：`id`（即 aid）、`bvid`、`title`、`upper`、`duration`、`fav_time`、`cnt_info{collect,play,danmaku,like}`。

```ts
const list = await client.favorite.resourceList({ mediaId: 12345678, pn: 1, ps: 20 })
console.log(list.medias.map(m => `${m.title} (${m.bvid})`))
```

### favorite.createdListAll(upMid: number, options?): Promise<FavFolderList>

用户创建的全部收藏夹。公开。返回 `{ count, list: FavFolder[] }`。

```ts
const favs = await client.favorite.createdListAll(client.session.dedeUserID)
console.log(favs.list.map(f => `${f.title} (${f.id})`))
```

### favorite.deal(rid: number, addMediaIds: number[], delMediaIds = []): Promise<FavDealResult>

批量操作收藏（视频 `rid` = aid）。csrf，需登录。返回 `{ prompt, success_num, toast_msg }`。

### favorite.addVideo(aid: number, folderIds: number[]): Promise<FavDealResult>

收藏视频到指定收藏夹（`deal` 的便捷封装）。csrf，需登录。

### favorite.removeVideo(aid: number, folderIds: number[]): Promise<FavDealResult>

从指定收藏夹取消收藏。csrf，需登录。

### favorite.isFav(aid: number): Promise<{ count: number; list: FavMedia[] }>

查询当前登录用户是否已收藏该视频（返回命中的收藏夹列表）。需登录。

---

## 12. history — 历史记录

均需要登录（Cookie）。

### history.cursor(params?): Promise<HistoryListResult>

历史记录列表，游标分页。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `max` | `number` | 上一页最后一条的 `aid`（首页不传） |
| `viewAt` | `number` | 上一页最后一条的查看时间戳（秒） |
| `business` | `string` | 业务类型（如 `archive` 视频） |
| `ps` | `number` | 每页数量 |

返回 `{ cursor{max,view_at,ps}, list: HistoryItem[], tab }`。`HistoryItem` 关键字段：`aid`、`bvid`、`cid`、`title`、`progress`(观看进度秒)、`duration`、`owner{mid,name,face}`。

```ts
const page1 = await client.history.cursor({ ps: 20 })
const { max, view_at, business } = page1.cursor
const page2 = await client.history.cursor({ max, viewAt: view_at, business, ps: 20 })
```

### history.clear(): Promise<unknown>

清空全部历史记录。需登录。**不可恢复**。

### history.delete(aid: number): Promise<unknown>

删除单条历史记录。需登录。

---

## 13. danmaku — 弹幕

### danmaku.realtime(cid: number): Promise<DanmakuResult>

实时弹幕（XML 接口自动 deflate 解压 + 解析）。**公开，无需登录**。每个分 P 一段，长视频按段取。

返回 `{ state, items: DanmakuItem[] }`：

| DanmakuItem 字段 | 说明 |
| --- | --- |
| `time` | 视频内出现时间（秒） |
| `mode` | 弹幕类型（1~3 滚动、4 底、5 顶、6 逆向、7 高级、8 代码） |
| `size` | 字号 |
| `color` | 颜色（十进制 RGB888） |
| `ctime` | 发送时间戳（秒） |
| `pool` | 弹幕池类型 |
| `midHash` | 发送者 mid 哈希 |
| `dmid` | 弹幕唯一 id |
| `text` | 内容 |
| `weight?` | 屏蔽等级（可能缺失） |

```ts
const dm = await client.danmaku.realtime(video.cid)
console.log(`共 ${dm.items.length} 条弹幕`)
console.log(dm.items.slice(0, 5).map(d => `[${d.time.toFixed(1)}s] ${d.text}`))
```

### danmaku.historyIndex(cid: number, month: string): Promise<string[] | null>

历史弹幕日期索引。需登录。`month` 格式 `YYYY-MM`，返回该月有历史弹幕的日期列表（`YYYY-MM-DD`）。

### danmaku.history(cid: number, date: string): Promise<DanmakuResult>

指定日期的历史弹幕（XML）。需登录。`date` 格式 `YYYY-MM-DD`。返回结构同 `realtime`。

### danmaku.historySeg(cid: number, date: string): Promise<Uint8Array>

历史弹幕 protobuf 分段（原始 proto 字节）。需登录。需自行按 `bilibili-API-collect` 的 `DmSegMobileReply` proto 定义解析。

### 独立工具函数

```ts
import { parseDanmakuXml, decodeInflate } from 'bilibili-api-sdk'

parseDanmakuXml(xmlString)      // 解析标准 XML 弹幕文本 → DanmakuResult
decodeInflate(uint8Bytes)       // deflate 解压（带头 → raw deflate → 原文 三级兜底）
```

---

## 14. 枚举与常量速查

均从包根导出，`import { ... } from 'bilibili-api-sdk'`。

### CommentType（评论区类型）

| 成员 | 值 | 成员 | 值 |
| --- | --- | --- | --- |
| `VIDEO` | 1 | `AUDIO` | 14 |
| `TOPIC` | 2 | `JURY` | 15 |
| `ACTIVITY` | 4 | `DYNAMIC` | 17 |
| `BLACKROOM` | 6 | `MANGA` | 22 |
| `GALLERY` | 11 | `COURSE` | 33 |
| `ARTICLE` | 12 | | |

### CommentSort：`BY_TIME` 0 / `BY_HOT` 1 / `BY_LIKE` 2

### SearchType：`VIDEO` / `USER` / `LIVE_ROOM` / `LIVE_USER` / `BANGUMI` / `FILM` / `PGC` / `ARTICLE`

### SearchOrder：`TOTAL_RANK` / `CLICK` / `PUBDATE` / `DM` / `SCORES`

### FavOrder：`MTIME` / `VIEW` / `PUBTIME`

### QrStatus（扫码状态）：`SUCCESS` 0 / `NOT_SCANNED` 86101 / `SCANNED_NOT_CONFIRMED` 86090 / `EXPIRED` 86038

### RelationAttr（关注关系）：`UNFOLLOWED` 0 / `FOLLOWED` 2 / `MUTUAL` 6 / `BLOCKED` 128

### VideoQuality（qn 清晰度）

| 成员 | 值 | 成员 | 值 |
| --- | --- | --- | --- |
| `Q240P` | 6 | `Q1080PPlus` | 112 |
| `Q360P` | 16 | `Q1080P60` | 116 |
| `Q480P` | 32 | `Q4K` | 120 |
| `Q720P` | 64 | `QHDR` | 125 |
| `Q720P60` | 74 | `QDolbyVision` | 126 |
| `Q1080P` | 80 | `Q8K` | 127 |
| `QSmart` | 100 | `QHDRVivid` | 129 |

### FnVal（流格式位标志，可组合求和）

`MP4` 1 / `DASH` 16 / `HDR` 64 / `Q4K` 128 / `DOLBY_AUDIO` 256 / `DOLBY_VISION` 512 / `Q8K` 1024 / `AV1` 2048 / `ALL_DASH` 4048 / `HDR_VIVID` 16384

### VideoCodec：`AVC` 7 / `HEVC` 12 / `AV1` 13

### AudioQuality：`Q64K` 30216 / `Q132K` 30232 / `Q192K` 30280 / `DOLBY` 30250 / `HI_RES` 30251

### VIDEO_ZONE：分区 id → 名称映射（`Record<number, string>`）

---

## 15. 鉴权链路说明

使用者通常**无需手动处理**以下任何环节，SDK 已全部自动化；此处仅说明内部机制便于排查问题。

| 机制 | 说明 |
| --- | --- |
| **WBI 签名** | `WbiKeyManager` 从 nav 接口拉取 `wbi_img`，key 缓存 1 小时自动刷新；签名参数按 key 排序、过滤 `!'()*` 特殊字符、大写百分号编码。响应出现 `v_voucher` 时自动强制刷新 key 并重试一次 |
| **csrf** | 所有 POST 写操作自动注入 `csrf = bili_jct`；缺失时报 `-103` / `-111` |
| **buvid** | 构造时 `autoInit`（默认开）异步经 spi 接口获取真实 `buvid3/4` 并写入 session；失败回退本地生成。缺失 buvid 易触发 `-412` 风控 |
| **bili_ticket** | `BiliTicketManager` 生成 HMAC-SHA256 JWT 写入 cookie，有效期 3 天，自动续签 |
| **APP sign** | TV 登录接口自动使用内置 APP key 做 md5 签名（`appSign` / `APP_KEYS` 亦导出供高级用法） |

**风控建议**：

- 控制请求频率，避免并发轰炸（触发 `-352` / `-412` / `-799`）。
- 写操作（点赞、评论、关注等）务必使用真实登录 Cookie，游客调用大概率失败。
- 长时间运行的服务建议定期 `login.nav()` 校验登录态，并持久化 `cookieString()`。

---

> 完整字段级类型定义请参考包内 `dist/**/*.d.ts`（IDE 安装后可直接跳转）；接口原始规格参考 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)。
