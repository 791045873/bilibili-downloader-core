import { createHmac } from 'node:crypto'
import type { BilibiliHttp } from '../http/http.js'

const TICKET_ALGO = 'XgwSnGZ1p'
const TICKET_KEY_ID = 'ec02'
const TICKET_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 天

/**
 * bili_ticket（可选风控缓解）
 * 来源: bilibili-API-collect/docs/misc/sign/bili_ticket.md
 * 生成的 JWT 存入 cookie `bili_ticket`，有效期约 3 天。
 */
export class BiliTicketManager {
  private ticket: string | null = null
  private createdAt = 0

  /** 生成 hexsign = hmac_sha256(key=ALGO, msg="ts"+timestamp) */
  static buildHexsign(timestamp: number): string {
    return createHmac('sha256', TICKET_ALGO).update(`ts${timestamp}`).digest('hex')
  }

  /**
   * 获取 ticket（含缓存），并写入 cookieJar。
   * @param http 底层 http 客户端（其 jar 会被写入 bili_ticket）
   * @param csrf 可选 bili_jct
   */
  async get(http: BilibiliHttp, csrf?: string): Promise<string> {
    if (this.ticket && Date.now() - this.createdAt < TICKET_TTL_MS) {
      return this.ticket
    }
    const ts = Math.floor(Date.now() / 1000)
    const hexsign = BiliTicketManager.buildHexsign(ts)
    const form = new URLSearchParams({
      key_id: TICKET_KEY_ID,
      hexsign,
      'context[ts]': String(ts),
    })
    if (csrf) form.set('csrf', csrf)

    const res = await http.post<{
      code: number
      message: string
      data?: { ticket?: string; ttl?: number }
    }>('https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket', {
      body: form,
      withCookie: true,
      headers: { Referer: 'https://www.bilibili.com/' },
    })

    const ticket = res.body?.data?.ticket
    if (!ticket || res.body?.code !== 0) {
      return this.ticket ?? ''
    }
    this.ticket = ticket
    this.createdAt = Date.now()
    http.jar.set('bilibili.com', 'bili_ticket', ticket)
    return ticket
  }

  /** 强制重置缓存（便于测试） */
  reset(): void {
    this.ticket = null
    this.createdAt = 0
  }
}
