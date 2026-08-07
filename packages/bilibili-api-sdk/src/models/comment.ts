/** 评论相关模型 */

/** 评论类型代码（见 bilibili-API-collect/docs/comment/readme.md） */
export enum CommentType {
  VIDEO = 1,
  TOPIC = 2,
  ACTIVITY = 4,
  BLACKROOM = 6,
  GALLERY = 11,
  ARTICLE = 12,
  AUDIO = 14,
  JURY = 15,
  DYNAMIC = 17,
  MANGA = 22,
  COURSE = 33,
}

/** 排序方式 */
export enum CommentSort {
  BY_TIME = 0,
  BY_HOT = 1,
  BY_LIKE = 2,
}

export interface ReplyItem {
  rpid: number
  rpid_str?: string
  oid: number
  type: number
  mid: number
  root: number
  parent: number
  dialog?: number
  count: number
  rcount: number
  floor: number
  state: number
  fansgrade: number
  attr: number
  ctime: number
  like: number
  action: number
  member: ReplyMember
  content: ReplyContent
  replies?: ReplyItem[]
  reply_control?: { sub_reply_entry_text?: string; sub_reply_title_text?: string }
}

export interface ReplyMember {
  mid: string
  uname: string
  sex: string
  sign: string
  avatar: string
  level_info?: { current_level: number }
  official_verify?: OfficialVerify
  vip?: Vip
  pendant?: unknown
  [key: string]: unknown
}

export interface OfficialVerify {
  type: number
  desc: string
}

export interface Vip {
  status: number
  theme_type: number
  label?: { text?: string; label_theme?: string }
  [key: string]: unknown
}

export interface ReplyContent {
  message: string
  members?: { mid?: number; uname?: string }[]
  emote?: Record<string, unknown>
}

export interface ReplyList {
  replies: ReplyItem[] | null
  root?: ReplyItem | null
  page: Paging
  top_replies?: ReplyItem[]
  upper?: { mid: number; top: ReplyItem[] }
  cursor?: unknown
}

export interface Paging {
  count: number
  num: number
  size: number
}

export interface ReplyAddResult {
  rpid: number
  rpid_str?: string
  success?: number
}

export interface ReplyActionResult {
  like: boolean
}
