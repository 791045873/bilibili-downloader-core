/** 搜索相关模型 */

/** 综合搜索（/x/web-interface/wbi/search/all/v2 data） */
export interface SearchAllResult {
  seid: string
  page: number
  page_size: number
  numResults: number
  numPages: number
  suggest_keyword?: string
  rqt_type: string
  cost_time?: Record<string, unknown>
  exp_list?: unknown
  egg_hit?: unknown
  video?: SearchVideoResult
  bili_user?: { result?: SearchUserItem[] }
  media_bangumi?: unknown
  media_ft?: unknown
  pgc?: unknown
  live_room?: { result?: unknown[] }
  live_user?: { result?: unknown[] }
  article?: unknown
  [key: string]: unknown
}

export interface SearchVideoItem {
  type: string
  id: number
  author: string
  mid: number
  typeid: string
  typename: string
  arcurl: string
  aid: string
  bvid: string
  title: string
  description: string
  pic: string
  play: number
  video_review: number
  favorites: number
  tag: string
  review: number
  pubdate: number
  duration: string
  badgepay?: boolean
  is_pay?: number
  is_union_video?: number
  rank_score?: number
  [key: string]: unknown
}

export interface SearchVideoResult {
  numResults?: number
  numPages?: number
  page?: number
  page_size?: number
  result: SearchVideoItem[]
}

export interface SearchUserItem {
  type: string
  mid: string
  uname: string
  usign: string
  fans: number
  videos: number
  upic: string
  level: number
  gender: number
  official_verify: { type: number; desc: string }
  [key: string]: unknown
}

export interface SearchUserResult {
  numResults?: number
  numPages?: number
  page?: number
  page_size?: number
  result: SearchUserItem[]
}

/** 类型搜索（/x/web-interface/wbi/search/type data） */
export interface SearchTypeResult<T = unknown> {
  seid: string
  page: number
  pagesize: number
  numResults: number
  numPages: number
  suggest_keyword?: string
  rqt_type: string
  cost_time?: unknown
  pageinfo?: unknown
  result: T
}

/** 热搜（/x/web-interface/wbi/search/square data） */
export interface HotWordItem {
  keyword: string
  show_name?: string
  icon?: string
  word_type?: number
  goto_type?: number
  goto_value?: string
  url?: string
  [key: string]: unknown
}

/** 搜索建议（/s.search.bilibili.com/main/suggest） */
export interface SuggestResult {
  result?: SuggestItem[]
  code?: number
}

export interface SuggestItem {
  value: string
  name?: string
  type?: string
  [key: string]: unknown
}

/** 搜索类型枚举 */
export enum SearchType {
  VIDEO = 'video',
  USER = 'bili_user',
  LIVE_ROOM = 'live_room',
  LIVE_USER = 'live_user',
  BANGUMI = 'media_bangumi',
  FILM = 'media_ft',
  PGC = 'pgc',
  ARTICLE = 'article',
}

/** 排序方式 */
export enum SearchOrder {
  TOTAL_RANK = 'totalrank',
  CLICK = 'click',
  PUBDATE = 'pubdate',
  DM = 'dm',
  SCORES = 'scores',
}
