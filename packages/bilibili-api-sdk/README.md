# bilibili-api-sdk

非官方 Bilibili（哔哩哔哩）TypeScript SDK，**零运行时依赖**（仅用 Node 内置 `fetch` 与 `node:crypto`）。

接口规格参考 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)（本仓库归档副本），实现方式参考了 [BiliPai](https://github.com/Android-Pure-Bilibili/BiliPai) Android 客户端。

> ⚠️ **免责声明**
> - 本项目仅供学习与技术交流，接口可能随 B 站风控策略变化而失效。
> - 文档（bilibili-API-collect）基于 **CC-BY-NC-4.0** 协议，使用本项目及接口请遵守 [B 站用户协议](https://www.bilibili.com/blackboard/activity-ndMYCWhPL4.html)，**请勿用于商业用途或滥用接口**（批量抓取、并发爆破等）。
> - 使用本项目产生的任何风险与后果由使用者自行承担。

## 特性

- **完整鉴权链路**：WBI 签名（自动拉取/缓存/过期刷新 + `v_voucher` 自动重试）、APP 签名、`bili_ticket`、`buvid3/4`、Cookie 会话（SESSDATA / bili_jct / DedeUserID）
- **覆盖核心域**：视频、用户、评论、动态、搜索、收藏夹、历史、弹幕、登录
- **零依赖**：运行时不安装任何第三方包，类型安全（严格 TS）
- **错误统一**：非零 `code` 抛 `BiliError`，携带原始响应 `raw`

## 安装

```bash
npm install
npm run build   # 输出到 dist/
npm test        # vitest 单测
```

Node >= 18（需要全局 `fetch`）。

**完整 API 参考文档：[API.md](./API.md)**（含全部方法签名、参数、返回值与示例，随 npm 包一起发布，安装后可在 `node_modules/bilibili-api-sdk/API.md` 查阅）。

## Release tgz 发布

如果你不打算发布到 npmjs，可以走 GitHub Release 的 tgz 方式：

1. 本地或 CI 先执行 `npm run build`。
2. 执行 `npm pack` 生成 `.tgz` 包。
3. 给仓库打一个 tag，比如 `v0.1.0`，推送后由 GitHub Actions 自动创建 Release 并附带 tgz。
4. 其他项目通过 Release 下载链接、`file:` 路径或内部制品源安装这个 tgz。

仓库里已经包含对应的自动化工作流：[.github/workflows/release.yml](.github/workflows/release.yml)。

## 快速开始

```ts
import { BilibiliClient } from 'bilibili-api-sdk'

const client = new BilibiliClient({
  // 可选：从浏览器导出的 Cookie
  cookies: 'SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx',
})

// 公开接口（自动 WBI 签名）
const video = await client.video.view({ bvid: 'BV1L9Uoa9EUx' })
console.log(video.title)

const hot = await client.search.hot()
console.log(hot.trending.list.slice(0, 5).map((x) => x.keyword))

const danmaku = await client.danmaku.realtime(video.cid)
console.log('弹幕数:', danmaku.items.length)

// 登录（二维码扫码，自动写入会话）
const qr = await client.login.qrGenerate()
// 把 qr.url 渲染成二维码给用户扫
const result = await client.login.qrPoll(qr.qrcode_key) // 轮询直到 code === 0

// 写操作（需登录，csrf 自动注入）
await client.video.triple(video.aid)   // 一键三连
await client.comment.add(video.aid, '前排！')
```

## 会话持久化

```ts
// 登录后保存
const cookie = client.cookieString()   // "SESSDATA=...; bili_jct=...; ..."

// 下次恢复
const client2 = new BilibiliClient({ cookies: cookie })
```

## 目录结构

```
src/
  client.ts            # BilibiliClient 入口
  errors.ts            # BiliError 与错误码表
  http/                # fetch 封装 + CookieJar
  auth/                # wbi / appSign / biliTicket / buvid / session
  api/                 # 9 个业务模块
    login.ts video.ts user.ts comment.ts dynamic.ts search.ts
    favorite.ts history.ts danmaku.ts base.ts
  models/              # 响应数据模型（snake_case 对齐 B 站）
  utils/               # mixinKeyTab / encode / bvid
tests/                 # 含文档测试向量与 mock fetch 用例
```

## API 一览

> 下表仅为速查摘要，各方法的完整参数、返回值与示例请见 [API.md](./API.md)。

| 模块 | 方法 | 端点（摘要） | 鉴权 |
| --- | --- | --- | --- |
| login | `qrGenerate` / `qrPoll` / `qrLogin` | `/x/passport-login/web/qrcode/*` | - |
| login | `tvQrGenerate` / `tvQrPoll` | `/x/passport-tv-login/qrcode/*` | APP sign |
| login | `nav` / `isLoggedIn` / `logout` | `/x/web-interface/nav` 等 | Cookie |
| video | `view` | `/x/web-interface/wbi/view` | WBI |
| video | `playurl` | `/x/web-interface/wbi/playurl` | WBI |
| video | `like` / `triple` / `coin` | `/x/web-interface/archive/*` | csrf |
| video | `addFavorite` / `delFavorite` | `/x/web-interface/fav/video/*` | csrf |
| video | `related` / `toviewList` | `/x/web-interface/*` | WBI |
| user | `card` / `cards` | `/x/web-interface/card`、`/x/polymer/pc-electron/v1/user/cards` | WBI |
| user | `medalWall` | `/xlive/web-ucenter/user/MedalWall` | - |
| user | `following` / `followers` / `follow` / `unfollow` | `/x/web-interface/wbi/relation/*` | WBI + csrf |
| comment | `list` / `detail` | `/x/v2/reply/main` | - |
| comment | `add` / `del` / `like` | `/x/v2/reply/*` | csrf |
| dynamic | `spaceFeed` / `detail` | `/x/polymer/web-dynamic/v1/*` | - |
| dynamic | `publish` / `delete` / `like` | `/x/polymer/web-dynamic/v1/*` | csrf |
| search | `all` / `type` / `hot` / `defaultKeyword` | `/x/web-interface/wbi/search/*` | WBI |
| search | `suggest` | `/s.search.bilibili.com/main/suggest` | - |
| favorite | `folderInfo` / `resourceList` / `createdListAll` | `/x/v3/fav/*` | - |
| favorite | `deal` / `addVideo` / `removeVideo` | `/x/v3/fav/resource/deal` | csrf |
| history | `cursor` / `clear` / `delete` | `/x/web-interface/history/*` | Cookie |
| danmaku | `realtime` | `comment.bilibili.com/{cid}.xml`（deflate） | - |
| danmaku | `historyIndex` / `history` / `historySeg` | `/x/v2/dm/*` | Cookie |

## 鉴权说明

- **WBI**：`WbiKeyManager` 从 nav 拉取 `wbi_img`，缓存 1 小时；签名参数按 key 排序、过滤 `!'()*`、`encodeURIComponentCompat`（大写百分号 + `%20`）。遇到 `v_voucher` 自动刷新 key 并重试一次。
- **APP sign**：`appSign` 按 key 排序 + md5；`APP_KEYS` 内置 android / android_hd / tv / ios / web 五组 key。
- **bili_ticket**：`BiliTicketManager` 生成 JWT（`hmac_sha256`）写入 cookie，有效期 3 天。
- **buvid**：`autoInit`（默认开）异步经 spi 接口获取并回填 session/cookie。

## 局限与后续

- 未实现：直播、番剧/影视（PGC）、音频、漫画、充电、gRPC/WS 弹幕、投币回调等。扩展方式：`src/api/` 新增模块，继承 `BaseApi` 即可复用统一请求/鉴权。
- 写接口（点赞/投币等）在公开环境中体验有限，建议配合 Cookie 使用。

## License

代码部分：本项目自身（MIT 待定，按需调整）。
文档参考：[bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)（CC-BY-NC-4.0）。
