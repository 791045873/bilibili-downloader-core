import type { BilibiliHttp } from '../http/http.js'
import type { Session } from '../auth/session.js'
import type { WbiKeyManager } from '../auth/wbi.js'
import type { BiliTicketManager } from '../auth/biliTicket.js'
import { BiliError } from '../errors.js'
import {
  buildCacheKey,
  DEFAULT_CACHE_TTL_MS,
  identityFingerprint,
  isCacheableRequest,
  type ApiCacheStore,
} from '../cache/cacheStore.js'

export const DEFAULT_MAX_RETRIES = 4
export const DEFAULT_RETRY_BASE_DELAY_MS = 1000

export interface CacheConfig {
  store: ApiCacheStore
  ttlMs: number
}

export interface RetryConfig {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
  codes: number[]
  refreshCredentials: boolean
}

export interface ApiContext {
  http: BilibiliHttp
  session: Session
  wbi: WbiKeyManager
  biliTicket?: BiliTicketManager
  cache?: CacheConfig
  retry?: RetryConfig
}

export type ParamValue = string | number | boolean | undefined | null

export interface RequestOptions {
  /** url 参数（或 POST 表单） */
  params?: Record<string, ParamValue> | object
  /** 请求头 */
  headers?: Record<string, string>
  /** Referer */
  referer?: string
  /** 是否使用 WBI 签名，默认 false */
  wbi?: boolean
  /** 是否需要登录，默认 false */
  login?: boolean
  /** 是否允许游客（不注入 buvid），默认 true */
  guest?: boolean
  /** 缓存控制：false 关闭本次缓存；{ ttlMs } 覆盖 TTL。内置排除项不可开启缓存 */
  cache?: boolean | { ttlMs?: number }
}

/** 规整参数：丢弃 null/undefined，布尔转 0/1（兼容 http 层） */
export function cleanParams(params: object): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number)
  }
  return out
}

/** API 模块基类：统一请求、鉴权注入、错误处理 */
export class BaseApi {
  protected readonly ctx: ApiContext

  constructor(ctx: ApiContext) {
    this.ctx = ctx
  }

  protected get http(): BilibiliHttp {
    return this.ctx.http
  }

  protected get session(): Session {
    return this.ctx.session
  }

  protected get wbi(): WbiKeyManager {
    return this.ctx.wbi
  }

  /** 执行 web 端请求（支持 WBI 签名 + v_voucher 自动重试 + 接口缓存 + -412 自动重试） */
  protected async request<T>(
    method: 'GET' | 'POST',
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const params = cleanParams(options.params ?? {})

    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.referer) headers.Referer = options.referer

    const cacheCfg = this.ctx.cache
    const cacheStore = cacheCfg?.store
    const cacheable = cacheStore !== undefined && isCacheableRequest(method, url) && options.cache !== false
    const ttlMs =
      typeof options.cache === 'object' && options.cache.ttlMs ? options.cache.ttlMs : (cacheCfg?.ttlMs ?? DEFAULT_CACHE_TTL_MS)
    let cacheKey: string | undefined
    if (cacheable && cacheStore) {
      cacheKey = buildCacheKey(method, url, params, identityFingerprint(this.session.sessData))
      const hit = cacheStore.get(cacheKey)
      if (hit !== undefined) return hit as T
    }

    return this.runWithRetry(
      async () => {
        let signed = params
        if (options.wbi) signed = cleanParams(await this.wbi.sign(this.http, params))
        const res =
          method === 'GET'
            ? await this.http.get<{ code: number; message: string; data?: T; [k: string]: unknown }>(
                url,
                { params: signed, headers },
              )
            : await this.http.post<{ code: number; message: string; data?: T; [k: string]: unknown }>(
                url,
                { params: signed, headers },
              )
        if (res.status === 412) throw new BiliError(-412, '请求被拦截（风控，HTTP 412）')
        return this.unwrap(res.body, options)
      },
      {
        wbiVoucher: options.wbi,
        onSuccess: (data) => {
          if (cacheKey && cacheStore) cacheStore.set(cacheKey, data, ttlMs)
        },
      },
    )
  }

  private isVoucher(err: BiliError): boolean {
    return typeof err.raw?.data === 'object' && !!err.raw.data && 'v_voucher' in err.raw.data
  }

  /**
   * 统一重试包装：v_voucher 一次性重试（WBI 签名失效）在最内层；
   * 业务错误码（默认 -412）指数退避重试为外层，总共最多 maxRetries+1 次请求。
   */
  private async runWithRetry<T>(
    attempt: () => Promise<T>,
    opts: { wbiVoucher?: boolean; onSuccess?: (data: T) => void } = {},
  ): Promise<T> {
    const cfg = this.ctx.retry
    const enabled = cfg?.enabled ?? true
    const maxRetries = enabled ? (cfg?.maxRetries ?? DEFAULT_MAX_RETRIES) : 0
    const baseDelayMs = cfg?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    const retryCodes = cfg?.codes ?? [-412]
    const refreshCredentials = cfg?.refreshCredentials ?? true
    let credentialsRefreshed = false

    for (let attemptNo = 0; attemptNo <= maxRetries; attemptNo++) {
      try {
        const data = await attempt()
        opts.onSuccess?.(data)
        return data
      } catch (err) {
        if (opts.wbiVoucher && err instanceof BiliError && this.isVoucher(err)) {
          await this.wbi.getKeys(this.http, true)
          const data = await attempt()
          opts.onSuccess?.(data)
          return data
        }
        const retriable = err instanceof BiliError && retryCodes.includes(err.code)
        if (retriable && attemptNo < maxRetries) {
          if (refreshCredentials && !credentialsRefreshed) {
            credentialsRefreshed = true
            await this.refreshCredentials()
          }
          const delay = baseDelayMs * 2 ** attemptNo + Math.floor(Math.random() * 250)
          await new Promise<void>((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw new BiliError(-1, '重试循环异常结束')
  }

  /** 首次 -412 后刷新 buvid + bili_ticket（均静默，失败不阻断重试） */
  private async refreshCredentials(): Promise<void> {
    if (this.ctx.biliTicket) {
      try {
        this.ctx.biliTicket.reset()
        await this.ctx.biliTicket.get(this.http, this.session.csrf)
      } catch {
        // 静默
      }
    }
    try {
      const { fetchBuvid } = await import('../auth/buvid.js')
      const { b_3, b_4 } = await fetchBuvid(this.http)
      this.session.apply({ buvid3: b_3, buvid4: b_4 })
    } catch {
      // 静默
    }
  }

  /** 统一解包 ApiResponse：code !== 0 抛错；code===0 但含 v_voucher 也抛错（触发重试） */
  protected unwrap<T>(
    body: { code: number; message: string; data?: T; [k: string]: unknown } | null | undefined,
    options: RequestOptions = {},
  ): T {
    if (!body) throw new BiliError(-1, '空响应')
    if (body.code !== 0) {
      const msg = body.message || String(body.code)
      throw new BiliError(body.code, msg, body as never)
    }
    const data = body.data
    if (data && typeof data === 'object' && 'v_voucher' in (data as Record<string, unknown>)) {
      throw new BiliError(body.code, 'WBI 签名校验失败 / 需要人机验证', body as never)
    }
    return data as T
  }

  /** POST 表单（含 csrf 自动注入，-412 自动重试，不缓存） */
  protected async postForm<T>(
    url: string,
    form: Record<string, ParamValue>,
    options: Omit<RequestOptions, 'params'> = {},
  ): Promise<T> {
    const body: Record<string, ParamValue> = { ...form }
    if (!body.csrf && this.session.csrf) body.csrf = this.session.csrf
    return this.runWithRetry(async () => {
      const res = await this.http.post<{ code: number; message: string; data?: T }>(url, {
        body: cleanParams(body),
        headers: options.headers,
      })
      if (res.status === 412) throw new BiliError(-412, '请求被拦截（风控，HTTP 412）')
      return this.unwrap(res.body)
    })
  }

  /**
   * nav 接口：未登录时返回 code=-101 但 data 仍含 wbi_img，
   * 属正常状态，返回 data 不抛错。
   */
  protected async fetchNav<T extends { isLogin?: boolean }>(): Promise<T> {
    const res = await this.http.get<{
      code: number
      message: string
      data?: T
    }>('https://api.bilibili.com/x/web-interface/nav', {
      headers: { Referer: 'https://www.bilibili.com/' },
      retries: 2,
    })
    const body = res.body
    if (!body) throw new BiliError(-1, '空响应')
    if (body.code !== 0 && body.code !== -101) {
      throw new BiliError(body.code, body.message, body as never)
    }
    return body.data as T
  }
}
