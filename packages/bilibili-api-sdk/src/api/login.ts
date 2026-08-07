import { BaseApi, cleanParams, type ParamValue } from './base.js'
import { appSignWith, APP_KEYS } from '../auth/appSign.js'
import { BiliError } from '../errors.js'
import type { NavInfo } from '../models/user.js'
import { QrStatus, type QrGenerateResult, type QrPollResult, type TvAuthCodeResult, type TvPollResult } from '../models/login.js'

/** 登录 / 会话相关接口 */
export class LoginApi extends BaseApi {
  /** 获取登录状态与 WBI key（/x/web-interface/nav；未登录不抛错） */
  async nav(): Promise<NavInfo> {
    const info = await this.fetchNav<NavInfo>()
    if (info.isLogin) {
      this.session.apply({
        sessData: this.session.sessData,
        dedeUserID: info.mid,
      })
    }
    return info
  }

  /** 是否已登录 */
  async isLoggedIn(): Promise<boolean> {
    const info = await this.nav()
    return info.isLogin
  }

  /**
   * 申请 Web 二维码
   * 将返回的 url 生成二维码供用户扫描（可用 qrcode 库）。
   */
  async qrGenerate(): Promise<QrGenerateResult> {
    const res = await this.http.get<{
      code: number
      message: string
      data: QrGenerateResult
    }>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
      headers: { Referer: 'https://passport.bilibili.com/' },
    })
    return this.unwrap(res.body)
  }

  /**
   * 轮询扫码结果。成功（data.code === 0）时登录 cookie 已自动写入 session。
   * 返回 data.code 语义：0 成功 / 86101 未扫码 / 86090 已扫码未确认 / 86038 已失效。
   */
  async qrPoll(qrcodeKey: string): Promise<QrPollResult & { code: number }> {
    const res = await this.http.get<{
      code: number
      message: string
      data: QrPollResult
    }>('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', {
      params: { qrcode_key: qrcodeKey },
      headers: { Referer: 'https://passport.bilibili.com/' },
    })
    const body = res.body
    if (!body) throw new BiliError(-1, '轮询二维码失败：空响应')
    if (body.code !== 0) throw new BiliError(body.code, body.message, body)
    const data = body.data
    if (data.code === QrStatus.SUCCESS) {
      // Set-Cookie 已由 http 层吸收；同步到 session
      const sessData = this.http.jar.get('passport.bilibili.com', 'SESSDATA') ?? this.http.jar.get('bilibili.com', 'SESSDATA')
      const biliJct = this.http.jar.get('passport.bilibili.com', 'bili_jct') ?? this.http.jar.get('bilibili.com', 'bili_jct')
      const dedeUserID =
        this.http.jar.get('passport.bilibili.com', 'DedeUserID') ?? this.http.jar.get('bilibili.com', 'DedeUserID')
      this.session.apply({
        sessData,
        biliJct,
        dedeUserID: dedeUserID ? Number(dedeUserID) : undefined,
      })
    }
    return { ...data, code: data.code }
  }

  /** 便捷：完整扫码流程（生成 -> 轮询直到结果，timeoutMs 后返回 null） */
  async qrLogin(options?: { intervalMs?: number; timeoutMs?: number }): Promise<QrPollResult | null> {
    const intervalMs = options?.intervalMs ?? 2000
    const timeoutMs = options?.timeoutMs ?? 180_000
    const { qrcode_key } = await this.qrGenerate()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = await this.qrPoll(qrcode_key)
      if (result.code === QrStatus.SUCCESS) return result
      if (result.code === QrStatus.EXPIRED) throw new BiliError(86038, '二维码已失效')
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return null
  }

  /** TV 二维码 auth_code（APP 鉴权） */
  async tvQrGenerate(): Promise<TvAuthCodeResult> {
    const { appkey } = APP_KEYS.tv
    const base: Record<string, ParamValue> = { appkey, local_id: '0', ts: Math.floor(Date.now() / 1000) }
    const { params } = appSignWith(base, 'tv')
    const res = await this.http.post<{ code: number; message: string; data?: TvAuthCodeResult }>(
      'https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code',
      { body: cleanParams(params) },
    )
    return this.unwrap(res.body)
  }

  /** TV 二维码轮询（成功时返回 access_token 并可注入 cookie） */
  async tvQrPoll(authCode: string): Promise<TvPollResult> {
    const base: Record<string, ParamValue> = {
      appkey: appSignWith({}, 'tv').params.appkey,
      auth_code: authCode,
      local_id: '0',
      ts: Math.floor(Date.now() / 1000),
    }
    const { params } = appSignWith(base, 'tv')
    const res = await this.http.post<{ code: number; message: string; data?: TvPollResult }>(
      'https://passport.bilibili.com/x/passport-tv-login/qrcode/poll',
      { body: cleanParams(params) },
    )
    return this.unwrap(res.body)
  }

  /** 将 TV 登录返回的 cookie / token 写入 session */
  applyTvPollResult(result: TvPollResult): void {
    if (result.token_info?.access_token) {
      this.session.apply({ accessToken: result.token_info.access_token })
    }
    if (result.cookie_info?.cookies) {
      const get = (n: string) => result.cookie_info?.cookies.find((c) => c.name === n)?.value
      this.session.apply({
        sessData: get('SESSDATA'),
        biliJct: get('bili_jct'),
        dedeUserID: get('DedeUserID') ? Number(get('DedeUserID')) : undefined,
      })
    }
  }

  /** 注销登录（清除会话） */
  async logout(): Promise<void> {
    try {
      await this.http.post('https://passport.bilibili.com/login/exit/v2', {
        body: { biliCSRF: this.session.csrf },
        headers: { Referer: 'https://www.bilibili.com/' },
      })
    } finally {
      this.session.clear()
    }
  }
}
