import type { BilibiliHttp } from '../http/http.js'
import type { Session } from '../auth/session.js'
import type { WbiKeyManager } from '../auth/wbi.js'
import { BiliError } from '../errors.js'

export interface ApiContext {
  http: BilibiliHttp
  session: Session
  wbi: WbiKeyManager
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

  /** 执行 web 端请求（支持 WBI 签名 + v_voucher 自动重试） */
  protected async request<T>(
    method: 'GET' | 'POST',
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    let params = cleanParams(options.params ?? {})

    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.referer) headers.Referer = options.referer

    if (options.wbi) {
      params = cleanParams(await this.wbi.sign(this.http, params))
    }

    const attempt = async (): Promise<T> => {
      const res =
        method === 'GET'
          ? await this.http.get<{ code: number; message: string; data?: T; [k: string]: unknown }>(
              url,
              { params, headers },
            )
          : await this.http.post<{ code: number; message: string; data?: T; [k: string]: unknown }>(
              url,
              { params, headers },
            )
      return this.unwrap(res.body, options)
    }

    try {
      return await attempt()
    } catch (err) {
      // WBI 签名可能因 key 过期失效（data 返回 v_voucher）→ 强制刷新重试一次
      if (options.wbi && err instanceof BiliError && this.isVoucher(err)) {
        await this.wbi.getKeys(this.http, true)
        return attempt()
      }
      throw err
    }
  }

  private isVoucher(err: BiliError): boolean {
    return typeof err.raw?.data === 'object' && !!err.raw.data && 'v_voucher' in err.raw.data
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

  /** POST 表单（含 csrf 自动注入） */
  protected async postForm<T>(
    url: string,
    form: Record<string, ParamValue>,
    options: Omit<RequestOptions, 'params'> = {},
  ): Promise<T> {
    const body: Record<string, ParamValue> = { ...form }
    if (!body.csrf && this.session.csrf) body.csrf = this.session.csrf
    const res = await this.http.post<{ code: number; message: string; data?: T }>(url, {
      body: cleanParams(body),
      headers: options.headers,
    })
    return this.unwrap(res.body)
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
