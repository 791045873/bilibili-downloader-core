/** 视频分区 / 清晰度 / 流格式相关枚举 */
export const VIDEO_ZONE: Record<number, string> = {
  0: '全部分区',
  1: '动画',
  13: '番剧',
  167: '国创',
  3: '音乐',
  129: '舞蹈',
  4: '游戏',
  36: '知识',
  188: '科技',
  160: '运动',
  119: '鬼畜',
  155: '时尚',
  5: '生活',
  181: '影视',
  177: '纪录片',
  23: '电影',
  11: '电视剧',
}

/** qn 清晰度 */
export enum VideoQuality {
  Q240P = 6,
  Q360P = 16,
  Q480P = 32,
  Q720P = 64,
  Q720P60 = 74,
  Q1080P = 80,
  QSmart = 100,
  Q1080PPlus = 112,
  Q1080P60 = 116,
  Q4K = 120,
  QHDR = 125,
  QDolbyVision = 126,
  Q8K = 127,
  QHDRVivid = 129,
}

/** fnval 位标志 */
export const FnVal = {
  MP4: 1,
  DASH: 16,
  HDR: 64,
  Q4K: 128,
  DOLBY_AUDIO: 256,
  DOLBY_VISION: 512,
  Q8K: 1024,
  AV1: 2048,
  ALL_DASH: 4048,
  HDR_VIVID: 16384,
} as const

export type Qn = keyof typeof VideoQuality | number

/** 编码代码 */
export const VideoCodec = {
  AVC: 7,
  HEVC: 12,
  AV1: 13,
} as const

/** 音质代码 */
export const AudioQuality = {
  Q64K: 30216,
  Q132K: 30232,
  Q192K: 30280,
  DOLBY: 30250,
  HI_RES: 30251,
} as const

/** 视频基本信息（x/web-interface/view 的 data 主体） */
export interface VideoDetail {
  bvid: string
  aid: number
  videos: number
  tid: number
  tid_v2?: number
  tname: string
  tname_v2?: string
  copyright: number
  pic: string
  title: string
  pubdate: number
  ctime: number
  desc: string
  desc_v2?: DescV2Item[]
  state: number
  duration: number
  forward?: number
  mission_id?: number
  redirect_url?: string
  rights: VideoRights
  owner: VideoOwner
  stat: VideoStat
  argue_info?: { argue_link?: string; argue_msg?: string; argue_type?: number }
  dynamic?: string
  cid: number
  dimension?: Dimension
  pages: VideoPage[]
  subtitle?: { allow_submit?: boolean; list?: SubtitleItem[] }
  ugc_season?: UgcSeason
  staff?: Staff[]
  is_story?: boolean
  is_upower_exclusive?: boolean
  is_season_display?: boolean
  like_icon?: string
  [key: string]: unknown
}

export interface DescV2Item {
  raw_text: string
  type: number
  biz_id: number
}

export interface VideoRights {
  bp: number
  elec: number
  download: number
  movie: number
  pay: number
  hd5: number
  no_reprint: number
  autoplay: number
  ugc_pay: number
  is_cooperation: number
  ugc_pay_preview: number
  no_background?: number
  clean_mode?: number
  is_stein_gate?: number
  is_360?: number
  no_share?: number
  arc_pay?: number
  free_watch?: number
}

export interface VideoOwner {
  mid: number
  name: string
  face: string
}

export interface VideoStat {
  aid: number
  view: number
  danmaku: number
  reply: number
  favorite: number
  coin: number
  share: number
  now_rank: number
  his_rank: number
  like: number
  dislike: number
  evaluation: string
  vt?: number
  vv?: number
}

export interface Dimension {
  width: number
  height: number
  rotate: number
}

export interface VideoPage {
  cid: number
  page: number
  from: string
  part: string
  duration: number
  vid?: string
  weblink?: string
  dimension?: Dimension
  ctime?: number
}

export interface SubtitleItem {
  id: number
  lan: string
  lan_doc: string
  is_lock: boolean
  subtitle_url?: string
  author_mid?: number
  author?: UserBrief
}

export interface UserBrief {
  mid: number
  name: string
  sex?: string
  face: string
  sign?: string
  rank?: number
  birthday?: number
  is_fake_account?: number
  is_deleted?: number
}

export interface UgcSeason {
  id: number
  title: string
  cover?: string
  mid: number
  intro?: string
  sign_state?: number
  attribute?: number
  sections: UgcSeasonSection[]
  stat?: UgcSeasonStat
  ep_count: number
  season_type?: number
  is_pay_season?: boolean
  enable_vt?: number
}

export interface UgcSeasonSection {
  season_id: number
  section_id: number
  title: string
  type: number
  episodes: UgcSeasonEpisode[]
}

export interface UgcSeasonEpisode {
  season_id: number
  section_id: number
  id: number
  aid: number
  cid: number
  title: string
  arc: Partial<VideoDetail>
  bvid?: string
  pages?: VideoPage[]
}

export interface UgcSeasonStat {
  season_id: number
  view: number
  danmaku: number
  reply: number
  fav: number
  coin: number
  share: number
  now_rank: number
  his_rank: number
  like: number
  vt?: number
  vv?: number
}

export interface Staff {
  mid: number
  title: string
  name: string
  face: string
  vip?: object
  official?: object
  follower: number
  label_style?: number
}

/** 取流返回（x/player/wbi/playurl 的 data） */
export interface PlayUrlData {
  from?: string
  result?: string
  message?: string
  quality: number
  format: string
  timelength: number
  accept_format: string
  accept_description: string[]
  accept_quality: number[]
  video_codecid: number
  seek_param?: string
  seek_type?: string
  durl?: DurlSegment[]
  dash?: DashStream
  support_formats: SupportFormat[]
  high_format?: unknown
  last_play_time?: number
  last_play_cid?: number
  cur_language?: string
  language?: { support: boolean; items?: unknown[] }
}

export interface DurlSegment {
  order: number
  length: number
  size: number
  ahead?: string
  vhead?: string
  url: string
  backup_url?: string[]
}

export interface DashStream {
  duration: number
  minBufferTime?: number
  min_buffer_time?: number
  video: DashStreamItem[]
  audio: DashStreamItem[] | null
  dolby?: { type: number; audio: DashStreamItem[] }
  flac?: { display: boolean; audio: DashStreamItem }
}

export interface DashStreamItem {
  id: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[]
  backup_url?: string[]
  bandwidth: number
  mimeType?: string
  mime_type?: string
  codecs: string
  width?: number
  height?: number
  frameRate?: string
  frame_rate?: string
  sar?: string
  startWithSap?: number
  start_with_sap?: number
  SegmentBase?: { Initialization?: string; indexRange?: string }
  segment_base?: { initialization?: string; index_range?: string }
  codecid?: number
}

export interface SupportFormat {
  quality: number
  format: string
  new_description?: string
  display_desc?: string
  superscript?: string
  codecs?: string[] | null
}

/** 一键三连结果 */
export interface TripleResult {
  like: boolean
  coin: boolean
  fav: boolean
  multiply: number
}

/** 投币返回 data */
export interface CoinResult {
  like: boolean
}

/** 相关推荐（archive/related data 数组项） */
export type RelatedVideo = Partial<VideoDetail>

/** 排行榜 */
export interface RankingResult {
  note: string
  list: VideoDetail[]
}

/** 热门视频 */
export interface PopularResult {
  list: VideoDetail[]
  no_more: boolean
}
