/**
 * 简易 Cookie 存储，对齐 BiliPai AppSessionCookieJar 行为：
 * - 按 host 存储
 * - 自动吸收响应 Set-Cookie
 * - 注入关键鉴权 Cookie（SESSDATA / bili_jct / DedeUserID / buvid3 / buvid4 / bili_ticket）
 */
export interface Cookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
}

/** 解析单个 Set-Cookie 头 */
export function parseSetCookie(header: string): Cookie | null {
  const parts = header.split(';').map((p) => p.trim())
  if (parts.length === 0) return null
  const first = parts.shift() ?? ''
  const eq = first.indexOf('=')
  if (eq <= 0) return null
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1).trim()
  const cookie: Cookie = { name, value }
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower.startsWith('domain=')) {
      cookie.domain = part.slice(7)
    } else if (lower.startsWith('path=')) {
      cookie.path = part.slice(5)
    } else if (lower.startsWith('expires=')) {
      cookie.expires = Date.parse(part.slice(8))
    } else if (lower === 'httponly') {
      cookie.httpOnly = true
    } else if (lower === 'secure') {
      cookie.secure = true
    }
  }
  return cookie
}

/** 计算 cookie 可作用的 host（bilibili.com 子域名归一到主域） */
export function cookieDomainOf(host: string): string {
  if (host.endsWith('bilibili.com')) return 'bilibili.com'
  return host
}

export class CookieJar {
  private store = new Map<string, Map<string, Cookie>>()

  /** 显式注入（或更新）某个 cookie */
  set(host: string, name: string, value: string): void {
    const key = cookieDomainOf(host)
    let map = this.store.get(key)
    if (!map) {
      map = new Map()
      this.store.set(key, map)
    }
    map.set(name, { name, value })
  }

  /** 批量设置关键登录态 */
  setSession(session: {
    sessData?: string
    biliJct?: string
    dedeUserID?: string | number
    buvid3?: string
    buvid4?: string
    biliTicket?: string
  }): void {
    if (session.sessData) this.set('bilibili.com', 'SESSDATA', session.sessData)
    if (session.biliJct) this.set('bilibili.com', 'bili_jct', session.biliJct)
    if (session.dedeUserID !== undefined && session.dedeUserID !== '')
      this.set('bilibili.com', 'DedeUserID', String(session.dedeUserID))
    if (session.buvid3) this.set('bilibili.com', 'buvid3', session.buvid3)
    if (session.buvid4) this.set('bilibili.com', 'buvid4', session.buvid4)
    if (session.biliTicket) this.set('bilibili.com', 'bili_ticket', session.biliTicket)
  }

  /** 吸收响应头的 Set-Cookie */
  absorb(headers: Headers, host: string): void {
    const setCookieHeaders = headers.getSetCookie()
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header)
      if (!cookie) continue
      const key = cookieDomainOf(cookie.domain ?? host)
      let map = this.store.get(key)
      if (!map) {
        map = new Map()
        this.store.set(key, map)
      }
      // 过期删除
      if (cookie.expires !== undefined && cookie.expires < Date.now()) {
        map.delete(cookie.name)
        continue
      }
      map.set(cookie.name, cookie)
    }
  }

  /** 生成请求 Cookie 头 */
  buildHeader(host: string): string {
    const parts: string[] = []
    const seen = new Set<string>()

    // 精确 host 优先
    for (const key of [host, cookieDomainOf(host)]) {
      const map = this.store.get(key)
      if (!map) continue
      for (const [name, cookie] of map) {
        if (seen.has(name)) continue
        seen.add(name)
        if (cookie.expires !== undefined && cookie.expires < Date.now()) continue
        parts.push(`${name}=${cookie.value}`)
      }
    }
    return parts.join('; ')
  }

  /** 读取单个 cookie 值 */
  get(host: string, name: string): string | undefined {
    for (const key of [host, cookieDomainOf(host)]) {
      const map = this.store.get(key)
      const cookie = map?.get(name)
      if (cookie) return cookie.value
    }
    return undefined
  }

  /** 解析并批量导入 `a=1; b=2` 形式的 Cookie 字符串 */
  setFromString(cookieString: string, host = 'bilibili.com'): void {
    for (const part of cookieString.split(';')) {
      const eq = part.indexOf('=')
      if (eq <= 0) continue
      const name = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()
      if (name) this.set(host, name, value)
    }
  }

  /** 清除全部 */
  clear(): void {
    this.store.clear()
  }

  /** 导出快照（便于序列化持久化） */
  toObject(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    for (const [host, map] of this.store) {
      out[host] = {}
      for (const [name, cookie] of map) {
        out[host][name] = cookie.value
      }
    }
    return out
  }

  /** 序列化为 `a=1; b=2` 字符串（默认主域） */
  toString(): string {
    return this.buildHeader('bilibili.com')
  }
}
