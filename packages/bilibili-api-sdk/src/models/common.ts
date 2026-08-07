/** B 站接口统一响应外壳 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  ttl?: number
  data: T
}

export interface Paging {
  count: number
  num: number
  size: number
  total?: number
}

/** 分页游标 */
export interface Cursor<T = number> {
  max: T
  view_at: number
  business?: string
  ps?: number
}
