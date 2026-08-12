import { BilibiliHttp } from './http/http.js'
import { CookieJar } from './http/cookieJar.js'
import { Session } from './auth/session.js'
import { WbiKeyManager } from './auth/wbi.js'
import { BiliTicketManager } from './auth/biliTicket.js'
import type { ApiContext } from './api/base.js'
import { DEFAULT_CACHE_TTL_MS, MemoryCacheStore, type ApiCacheStore } from './cache/cacheStore.js'
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_BASE_DELAY_MS,
  type RetryConfig,
} from './api/base.js'
import { LoginApi } from './api/login.js'
import { VideoApi } from './api/video.js'
import { UserApi } from './api/user.js'
import { CommentApi } from './api/comment.js'
import { DynamicApi } from './api/dynamic.js'
import { SearchApi } from './api/search.js'
import { FavoriteApi } from './api/favorite.js'
import { HistoryApi } from './api/history.js'
import { DanmakuApi } from './api/danmaku.js'
import { BangumiApi, CheeseApi } from './api/pgc.js'
import { PlayerApi } from './api/player.js'

export interface ClientOptions {
  /** 自定义 User-Agent */
  userAgent?: string
  /** 预置 Cookie 字符串（如从浏览器导出） */
  cookies?: string
  /** 预置会话字段（优先于 cookies） */
  session?: {
    sessData?: string
    biliJct?: string
    dedeUserID?: number
    accessToken?: string
    buvid3?: string
    buvid4?: string
  }
  /** 是否自动发起 buvid/bili_ticket 初始化，默认 true */
  autoInit?: boolean
  /** 接口级缓存配置。默认开启（内存缓存，TTL 24h）。 */
  cache?: {
    enabled?: boolean
    ttlMs?: number
    maxEntries?: number
    store?: ApiCacheStore
  }
  /** 业务错误码自动重试配置（默认 -412，最多重试 4 次 = 总共 5 次请求）。 */
  retry?: {
    enabled?: boolean
    maxRetries?: number
    baseDelayMs?: number
    codes?: number[]
    refreshCredentials?: boolean
  }
}

/** 哔哩哔哩 API 客户端（入口） */
export class BilibiliClient {
  readonly http: BilibiliHttp
  readonly session: Session
  readonly wbi: WbiKeyManager
  readonly biliTicket: BiliTicketManager

  readonly login: LoginApi
  readonly video: VideoApi
  readonly user: UserApi
  readonly comment: CommentApi
  readonly dynamic: DynamicApi
  readonly search: SearchApi
  readonly favorite: FavoriteApi
  readonly history: HistoryApi
  readonly danmaku: DanmakuApi
  readonly bangumi: BangumiApi
  readonly cheese: CheeseApi
  readonly player: PlayerApi

  private readonly cacheStore?: ApiCacheStore

  constructor(options: ClientOptions = {}) {
    const jar = new CookieJar()
    if (options.cookies) jar.setFromString(options.cookies)

    this.http = new BilibiliHttp({ jar, userAgent: options.userAgent })
    this.session = new Session(
      {
        sessData: options.session?.sessData,
        biliJct: options.session?.biliJct,
        dedeUserID: options.session?.dedeUserID,
        accessToken: options.session?.accessToken,
        buvid3: options.session?.buvid3,
        buvid4: options.session?.buvid4,
      },
      jar,
    )
    this.wbi = new WbiKeyManager()
    this.biliTicket = new BiliTicketManager()

    // cookies 携带 SESSDATA 但未显式传入 session.sessData 时同步到 session，
    // 保证接口缓存的登录身份指纹（SESSDATA 短哈希）在多账号场景下正确隔离
    if (!this.session.sessData) {
      const sessFromCookies = this.http.jar.get('bilibili.com', 'SESSDATA')
      if (sessFromCookies) this.session.apply({ sessData: sessFromCookies })
    }

    const cacheEnabled = options.cache?.enabled !== false
    this.cacheStore = cacheEnabled
      ? (options.cache?.store ?? new MemoryCacheStore(options.cache?.maxEntries ?? 500))
      : undefined

    const retryCfg: RetryConfig = {
      enabled: options.retry?.enabled !== false,
      maxRetries: options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      codes: options.retry?.codes ?? [-412],
      refreshCredentials: options.retry?.refreshCredentials !== false,
    }

    const ctx: ApiContext = {
      http: this.http,
      session: this.session,
      wbi: this.wbi,
      biliTicket: this.biliTicket,
      cache: this.cacheStore ? { store: this.cacheStore, ttlMs: options.cache?.ttlMs ?? DEFAULT_CACHE_TTL_MS } : undefined,
      retry: retryCfg,
    }
    this.login = new LoginApi(ctx)
    this.video = new VideoApi(ctx)
    this.user = new UserApi(ctx)
    this.comment = new CommentApi(ctx)
    this.dynamic = new DynamicApi(ctx)
    this.search = new SearchApi(ctx)
    this.favorite = new FavoriteApi(ctx)
    this.history = new HistoryApi(ctx)
    this.danmaku = new DanmakuApi(ctx)
    this.bangumi = new BangumiApi(ctx)
    this.cheese = new CheeseApi(ctx)
    this.player = new PlayerApi(ctx)

    if (options.autoInit !== false) {
      // 异步初始化 buvid / bili_ticket，失败不影响主流程
      void this.initAsync().catch(() => undefined)
    }
  }

  private async initAsync(): Promise<void> {
    // spi 拉取真实 buvid 覆盖本地生成的兜底值（失败时 fetchBuvid 内部回退生成）
    const { fetchBuvid } = await import('./auth/buvid.js')
    const { b_3, b_4 } = await fetchBuvid(this.http)
    this.session.apply({ buvid3: b_3, buvid4: b_4 })
    this.biliTicket.get(this.http, this.session.csrf).catch(() => undefined)
  }

  /** 获取会话 Cookie 字符串（可持久化保存） */
  cookieString(): string {
    return this.http.jar.buildHeader('bilibili.com') || this.http.jar.toString()
  }

  /** 清空全部接口缓存（内存或磁盘） */
  clearCache(): void {
    this.cacheStore?.clear()
  }

  /**
   * 整体替换会话 Cookie（如从磁盘加载或扫码登录后切换）。
   * 清空 cookie jar 后导入新字符串，并同步登录态字段到 session。
   */
  setCookies(cookieString?: string): void {
    this.http.jar.clear()
    this.session.sessData = ''
    this.session.biliJct = ''
    this.session.dedeUserID = 0
    if (cookieString) {
      this.http.jar.setFromString(cookieString)
      const get = (name: string) => this.http.jar.get('bilibili.com', name)
      const dedeUserID = get('DedeUserID')
      this.session.apply({
        sessData: get('SESSDATA'),
        biliJct: get('bili_jct'),
        dedeUserID: dedeUserID ? Number(dedeUserID) : undefined,
      })
    } else {
      // 重新同步 buvid 等兜底 cookie
      this.session.apply({})
    }
  }
}
