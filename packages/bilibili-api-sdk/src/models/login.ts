/** 登录相关模型 */

/** Web 二维码生成返回 */
export interface QrGenerateResult {
  url: string
  qrcode_key: string
}

/** 二维码状态 */
export enum QrStatus {
  SUCCESS = 0,
  NOT_SCANNED = 86101,
  SCANNED_NOT_CONFIRMED = 86090,
  EXPIRED = 86038,
}

export interface QrPollResult {
  url: string
  refresh_token: string
  timestamp: number
  code: number
  message: string
  /** 是否成功（code === 0） */
  isLogin: boolean
  /** 跨域跳转 url（cookie 需从响应头读取） */
  cross_domain?: string
}

/** TV 二维码 auth_code 返回 */
export interface TvAuthCodeResult {
  url: string
  auth_code: string
}

/** TV 二维码 poll 返回 */
export interface TvPollResult {
  code: number
  message: string
  url?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
  mid?: number
  token_info?: {
    access_token: string
    refresh_token: string
    expires_in: number
    mid: number
    [key: string]: unknown
  }
  cookie_info?: {
    cookies: { name: string; value: string; http_only?: number; expires?: number; secure?: number }[]
  }
  [key: string]: unknown
}
