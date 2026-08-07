/** 用户信息 / 关系模型 */

/** 用户卡片（/x/web-interface/card 的 data.card） */
export interface UserCard {
  mid: string | number
  name: string
  sex: string
  approve: boolean
  rank: string
  face: string
  face_nft?: number
  face_nft_type?: number
  sign: string
  fans: number
  friend: number
  attention: number
  level_info: { current_level: number; current_min: number; current_exp: number; next_exp: number }
  pendant: Pendant
  nameplate: Nameplate
  Official: OfficialInfo
  official_verify: OfficialVerify
  vip: VipInfo
  is_senior_member?: number
  name_render?: unknown
  spaces?: unknown
  [key: string]: unknown
}

/** /x/web-interface/card 完整返回（含 top-level 统计） */
export interface CardResult {
  card: UserCard
  following: boolean
  archive_count: number
  article_count: number
  follower: number
  like_num: number
}

export interface VipInfo {
  type: number
  status: number
  due_date: number
  vip_pay_type: number
  theme_type?: number
  label?: {
    path?: string
    text?: string
    label_theme?: string
    text_color?: string
    bg_style?: number
    bg_color?: string
    border_color?: string
    use_img_label?: boolean
    img_label_uri_hans_static?: string
    img_label_uri_hant_static?: string
  }
  avatar_subscript?: number
  nickname_color?: string
  role?: number
  avatar_subscript_url?: string
}

export interface Pendant {
  pid: number
  name: string
  image: string
  expire: number
  image_enhance?: string
  image_enhance_frame?: string
}

export interface Nameplate {
  nid: number
  name: string
  image: string
  image_small: string
  level: string
  condition: string
}

export interface OfficialInfo {
  role: number
  title: string
  desc: string
  type: number
}

export interface OfficialVerify {
  type: number
  desc: string
}

/** 导航栏信息（/x/web-interface/nav data） */
export interface NavInfo {
  isLogin: boolean
  email_verified: number
  face: string
  level_info: { current_level: number; current_min: number; current_exp: number; next_exp: number }
  mid: number
  mobile_verified: number
  money: number
  moral: number
  official: OfficialInfo
  officialVerify: OfficialVerify
  pendant: Pendant
  scores: number
  uname: string
  vipDueDate: number
  vipStatus: number
  vipType: number
  vip_pay_type: number
  vip_label: { path?: string; text?: string; label_theme?: string }
  vip_avatar_subscript: number
  vip_nickname_color: string
  wallet?: { mid: number; bcoin_balance: number; coupon_balance: number; coupon_due_time?: number }
  wbi_img: { img_url: string; sub_url: string }
  is_jury?: boolean
}

/** 批量卡片（/x/polymer/pc-electron/v1/user/cards data 为 map） */
export interface UserCardBrief {
  mid: number
  face: string
  name: string
  official: OfficialInfo
  vip: VipInfo
  name_render?: unknown
}

/** 关注关系 attribute */
export const RelationAttr = {
  UNFOLLOWED: 0,
  FOLLOWED: 2,
  MUTUAL: 6,
  BLOCKED: 128,
} as const

export interface RelationUser {
  mid: number
  attribute: number
  mtime: number
  tag: number[]
  special: number
  uname: string
  face: string
  sign: string
  face_nft: number
  official_verify: OfficialVerify
  vip: VipInfo
  [key: string]: unknown
}

export interface RelationList {
  list: RelationUser[]
  total: number
  re_version?: number
  show_admin?: boolean
}

/** 粉丝勋章墙（/xlive/web-ucenter/user/MedalWall data） */
export interface MedalWall {
  list: MedalItem[]
  count: number
  close_space_medal?: number
  only_show_wearing?: number
  name?: string
  icon?: string
  uid?: number
  level?: number
}

export interface MedalItem {
  id: number
  medal_id: number
  level: number
  medal_color_start: number
  medal_color_end: number
  medal_color_border: number
  medal_name: string
  guard_level?: number
  target_id: number
  status: number
  is_lighted?: number
}

/** 用户空间基本信息（x/space/wbi/acc/info data） */
export interface SpaceAccInfo {
  mid: number
  name: string
  sex?: string
  face: string
  sign?: string
  [key: string]: unknown
}

/** 用户空间投稿搜索（x/space/wbi/arc/search data） */
export interface SpaceArcSearchData {
  list?: {
    tlist?: Record<string, unknown>
    vlist?: SpaceArchive[]
  }
  page?: {
    pn?: number
    ps?: number
    count?: number
  }
  episodic_button?: { text?: string; uri?: string }
  [key: string]: unknown
}

/** 空间投稿视频条目（字段宽松，部分字段随接口版本变动） */
export interface SpaceArchive {
  aid?: number
  bvid?: string
  title?: string
  pic?: string
  cid?: number
  first_cid?: number
  /** 时长：秒数或 "mm:ss" 字符串 */
  length?: number | string
  duration?: number
  created?: number
  play?: number
  comment?: number
  [key: string]: unknown
}

/** 用户合集/系列列表（x/polymer/web-space/seasons_series_list data） */
export interface SeasonsSeriesListData {
  items_lists?: {
    seasons_list?: Record<string, unknown>[]
    series_list?: Record<string, unknown>[]
  }
  [key: string]: unknown
}

/** 合集视频列表（x/polymer/web-space/seasons_archives_list data） */
export interface SeasonsArchivesListData {
  archives?: Record<string, unknown>[]
  page?: {
    page_num?: number
    page_size?: number
    total?: number
  }
  meta?: {
    season_id?: number
    name?: string
    cover?: string
    mid?: number
    upper?: string
    upper_name?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}
