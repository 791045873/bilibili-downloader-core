import { BaseApi, type ParamValue } from './base.js'
import {
  SearchAllResult,
  SearchOrder,
  SearchType,
  type HotWordItem,
  type SearchTypeResult,
  type SuggestResult,
} from '../models/search.js'

export interface SearchAllParams {
  keyword: string
  page?: number
  pageSize?: number
  [key: string]: ParamValue
}

export interface SearchTypeParams {
  keyword: string
  type: SearchType
  page?: number
  pageSize?: number
  order?: SearchOrder
  [key: string]: ParamValue
}

/** 搜索相关接口 */
export class SearchApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x/web-interface'

  /** 综合搜索 */
  async all(params: SearchAllParams): Promise<SearchAllResult> {
    return this.request('GET', `${SearchApi.WBI_HOST}/wbi/search/all/v2`, {
      params,
      wbi: true,
    })
  }

  /** 类型搜索（视频/用户/直播等） */
  async type(params: SearchTypeParams): Promise<SearchTypeResult> {
    return this.request('GET', `${SearchApi.WBI_HOST}/wbi/search/type`, {
      params,
      wbi: true,
    })
  }

  /** 热搜词 */
  async hot(limit = 20): Promise<{ trending: { list: HotWordItem[] }; [k: string]: unknown }> {
    return this.request('GET', `${SearchApi.WBI_HOST}/wbi/search/square`, {
      params: { limit },
      wbi: true,
    })
  }

  /** 搜索建议（无需 WBI） */
  async suggest(term: string): Promise<SuggestResult> {
    const res = await this.http.get<SuggestResult>(
      'https://s.search.bilibili.com/main/suggest',
      { params: { term, main_ver: 'v1' } },
    )
    return res.body ?? {}
  }

  /** 默认搜索词（轮换的普通词） */
  async defaultKeyword(): Promise<{ trackid?: string; word?: string; id?: number }> {
    return this.request('GET', `${SearchApi.WBI_HOST}/wbi/search/defaultword`, {
      wbi: true,
    })
  }
}
