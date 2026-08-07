import { BaseApi } from './base.js'

export interface HistoryItem {
  title: string
  cover: string
  cover_type: number
  cid: number
  aid: number
  bvid: string
  danmaku: number
  view: number
  progress: number
  duration: number
  vid: string
  videos: number
  owner: { mid: number; name: string; face: string }
  page: number
  [key: string]: unknown
}

export interface HistoryCursor {
  max: number
  view_at: number
  business: string
  ps: number
  [key: string]: unknown
}

export interface HistoryListResult {
  cursor: HistoryCursor
  list: HistoryItem[]
  tab: string
  show_pre_page: number
}

/** 历史记录相关接口 */
export class HistoryApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x/web-interface'

  /** 历史记录列表（分页用 max / view_at） */
  async cursor(params?: { max?: number; viewAt?: number; business?: string; ps?: number }): Promise<HistoryListResult> {
    return this.request('GET', `${HistoryApi.WBI_HOST}/history/cursor`, {
      params: {
        max: params?.max,
        view_at: params?.viewAt,
        business: params?.business,
        ps: params?.ps,
      },
      login: true,
    })
  }

  /** 清空历史记录 */
  async clear(): Promise<unknown> {
    return this.request('POST', `${HistoryApi.WBI_HOST}/history/clear`, {
      login: true,
    })
  }

  /** 删除单条历史记录 */
  async delete(aid: number): Promise<unknown> {
    return this.request('GET', `${HistoryApi.WBI_HOST}/history/delete`, {
      params: { aid },
      login: true,
    })
  }
}
