/**
 * SDK 统一错误类型与 B 站公共错误码
 *
 * 错误码来源: bilibili-API-collect/docs/misc/errcode.md 及各接口文档
 */

/** 常见公共错误码 → 中文描述 */
export const BILI_ERROR_MESSAGES: Record<number, string> = {
  '-1': '服务器开小差了',
  '-2': '请求失败',
  '-3': '请求被拒绝',
  '-4': '请求被拒绝',
  '-101': '账号未登录',
  '-102': '账号被封停',
  '-103': 'csrf 校验失败',
  '-104': '账号异常',
  '-105': '账号不存在',
  '-106': '账号已注销',
  '-107': '账号已注销',
  '-109': '请求异常',
  '-110': '请求异常',
  '-111': 'csrf 校验失败',
  '-112': '请求失败',
  '-113': '请求失败',
  '-114': '请求失败',
  '-115': '请求失败',
  '-304': '木有改动',
  '-307': '撞车跳转',
  '-352': '风控校验失败',
  '-400': '请求错误',
  '-401': '未授权',
  '-403': '访问权限不足',
  '-404': '啥都木有',
  '-405': '请求方式错误',
  '-409': '请求冲突',
  '-412': '请求被拦截（风控，检查 buvid3/cookie）',
  '-500': '服务器错误',
  '-503': '服务器繁忙',
  '-504': '服务器超时',
  '-509': '连接数超限',
  '-616': '审核中',
  '-617': '已被锁定',
  '-799': '请求过于频繁',
  '-8888': '数据加载失败',
}

/**
 * SDK 业务错误。code 为 B 站接口返回的 code（可能为 0 但业务失败，
 * 也可能为 HTTP 层面的错误）。
 */
export class BiliError extends Error {
  readonly code: number
  readonly raw: ApiFailure | null

  constructor(code: number, message: string, raw: ApiFailure | null = null) {
    super(message)
    this.name = 'BiliError'
    this.code = code
    this.raw = raw
  }
}

/** 接口返回体中 data 为 v_voucher 时抛出（WBI 签名失效/需人机验证） */
export class VoucherRequiredError extends BiliError {
  constructor() {
    super(0, '需要 v_voucher 人机验证，建议刷新 WBI key 或更换 IP/UA')
    this.name = 'VoucherRequiredError'
  }
}

export interface ApiFailure {
  code: number
  message: string
  ttl?: number
  [key: string]: unknown
}

export function describeCode(code: number): string {
  return BILI_ERROR_MESSAGES[code] ?? '未知错误'
}
