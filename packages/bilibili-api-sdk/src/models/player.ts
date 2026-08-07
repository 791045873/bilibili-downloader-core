/** 播放器信息（x/player/wbi/v2 的 data） */
export interface PlayerV2Data {
  aid?: number
  bvid?: string
  cid?: number
  subtitle?: PlayerSubtitle
  [key: string]: unknown
}

/** 字幕信息 */
export interface PlayerSubtitle {
  allow_submit?: boolean
  lan?: string
  lan_doc?: string
  subtitles: PlayerSubtitleItem[]
}

export interface PlayerSubtitleItem {
  id?: number
  lan: string
  lan_doc: string
  subtitle_url: string
  is_lock?: boolean
  author_mid?: number
  author?: { mid: number; name: string; face?: string }
}

/** 字幕 JSON 文件内容（subtitle_url 下载结果） */
export interface SubtitleJsonBody {
  font_size?: number
  font_color?: string
  background_alpha?: number
  background_color?: string
  Stroke?: string
  body: {
    from: number
    to: number
    sid?: number
    location?: number
    content: string
    music?: number
  }[]
}
