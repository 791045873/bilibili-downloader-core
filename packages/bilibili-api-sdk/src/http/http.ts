import { CookieJar } from './cookieJar.js'
import { BiliError } from '../errors.js'

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface HttpOptions {
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 是否携带 Cookie jar 并吸收 Set-Cookie，默认 true */
  withCookie?: boolean
  /** 超时（毫秒），默认 15000 */
  timeoutMs?: number
  /** 失败重试次数，默认 1 */
  retries?: number
}

export interface HttpResult<T = unknown> {
  status: number
  headers: Headers
  body: T
}

export class BilibiliHttp {
  readonly jar: CookieJar
  readonly userAgent: string

  constructor(options?: { jar?: CookieJar; userAgent?: string }) {
    this.jar = options?.jar ?? new CookieJar()
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT
  }

  private buildUrl(base: string, params?: Record<string, string | number | undefined>): string {
    if (!params) return base
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      qs.set(key, String(value))
    }
    const q = qs.toString()
    if (!q) return base
    return base + (base.includes('?') ? '&' : '?') + q
  }

  private buildHeaders(
    url: string,
    options: HttpOptions,
    host: string,
    method: string,
    contentType?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...options.headers,
    }
    if (options.withCookie !== false) {
      const cookie = this.jar.buildHeader(host)
      if (cookie) headers.Cookie = cookie
    }
    if (contentType && !headers['Content-Type']) {
      headers['Content-Type'] = contentType
    }
    if (method === 'POST' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
    }
    if (!headers.Origin) headers.Origin = new URL(url).origin
    return headers
  }

  /** 发起请求并解析为 JSON（或 raw 文本） */
  async request<T = unknown>(
    method: 'GET' | 'POST',
    url: string,
    options: HttpOptions & {
      params?: Record<string, string | number | undefined>
      body?: Record<string, string | number | undefined> | string | URLSearchParams
      raw?: boolean
      /** 返回原始字节（Uint8Array）而非文本/JSON */
      buffer?: boolean
    } = {},
  ): Promise<HttpResult<T>> {
    const { params, body, raw, buffer } = options
    const fullUrl = this.buildUrl(url, params)
    const host = new URL(fullUrl).host
    const timeoutMs = options.timeoutMs ?? 15000
    const retries = options.retries ?? 1

    let bodyInit: BodyInit | undefined
    let contentType: string | undefined
    if (body !== undefined) {
      if (typeof body === 'string') {
        bodyInit = body
      } else if (body instanceof URLSearchParams) {
        bodyInit = body
        contentType = 'application/x-www-form-urlencoded; charset=UTF-8'
      } else {
        const sp = new URLSearchParams()
        for (const [k, v] of Object.entries(body)) {
          if (v === undefined || v === null) continue
          sp.set(k, String(v))
        }
        bodyInit = sp
        contentType = 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers = this.buildHeaders(fullUrl, options, host, method, contentType)
        const res = await fetch(fullUrl, {
          method,
          headers,
          body: method === 'GET' ? undefined : bodyInit,
          signal: controller.signal,
          redirect: 'follow',
        })
        if (options.withCookie !== false) {
          this.jar.absorb(res.headers, host)
        }

        if (buffer) {
          const buf = new Uint8Array(await res.arrayBuffer())
          return { status: res.status, headers: res.headers, body: buf as unknown as T }
        }

        if (raw) {
          const text = await res.text()
          return { status: res.status, headers: res.headers, body: text as unknown as T }
        }

        const text = await res.text()
        let parsed: unknown = text
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          // 非 JSON 响应原样返回文本
        }
        return { status: res.status, headers: res.headers, body: parsed as T }
      } catch (err) {
        lastError = err
        if (attempt >= retries) break
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new BiliError(-1, `网络请求失败: ${String(lastError)}`)
  }

  async get<T = unknown>(
    url: string,
    options?: HttpOptions & {
      params?: Record<string, string | number | undefined>
      raw?: boolean
      buffer?: boolean
    },
  ): Promise<HttpResult<T>> {
    return this.request<T>('GET', url, options ?? {})
  }

  async post<T = unknown>(
    url: string,
    options?: HttpOptions & {
      params?: Record<string, string | number | undefined>
      body?: Record<string, string | number | undefined> | string | URLSearchParams
      raw?: boolean
      buffer?: boolean
    },
  ): Promise<HttpResult<T>> {
    return this.request<T>('POST', url, options ?? {})
  }
}
