/** 收藏夹相关模型 */

/** 收藏夹信息（/x/v3/fav/folder/info data） */
export interface FavFolder {
  id: number
  fid: number
  mid: number
  attr: number
  title: string
  cover: string
  upper: { mid: number; name: string; face: string }
  media_count?: number
  count?: number
  intro?: string
  state?: number
  fav_state?: number
  like_state?: number
  type?: number
  [key: string]: unknown
}

/** 收藏夹内容（/x/v3/fav/resource/list data） */
export interface FavResourceList {
  count: number
  has_more: boolean
  info: FavFolder
  medias: FavMedia[]
}

export interface FavMedia {
  id: number
  type: number
  title: string
  cover: string
  intro: string
  page: number
  duration: number
  upper: { mid: number; name: string; face: string }
  attr: number
  cnt_info: {
    collect: number
    play: number
    danmaku: number
    like: number
    up_play?: number
  }
  link: string
  ctime: number
  pubtime: number
  fav_time: number
  bvid: string
  season?: unknown
  ogv?: unknown
  [key: string]: unknown
}

/** 收藏夹列表（/x/v3/fav/folder/created/list-all data） */
export interface FavFolderList {
  count: number
  list: FavFolder[]
  season?: unknown
  ep?: unknown
}

/** 收藏操作返回 */
export interface FavDealResult {
  prompt: boolean
  success_num?: number
  toast_msg?: string
  ga_data?: unknown
}

/** 收藏夹操作类型 */
export enum FavAction {
  ADD = 1,
  DEL = 2,
}

/** 排序方式 */
export enum FavOrder {
  MTIME = 'mtime',
  VIEW = 'view',
  PUBTIME = 'pubtime',
}
