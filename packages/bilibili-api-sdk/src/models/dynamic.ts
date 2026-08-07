/** 动态（社交）模型 */

/** 空间动态流（/x/polymer/web-dynamic/v1/feed/space data） */
export interface SpaceDynamicFeed {
  items: DynamicItem[]
  offset: string
  has_more: boolean
  update_baseline?: string
}

/** 动态卡片 item（type 见动态类型对照，文档未完整覆盖） */
export interface DynamicItem {
  id_str: string
  type?: string
  visible?: boolean
  modules?: {
    module_dynamic?: {
      type?: string
      desc?: { text?: string }
      major?: DynamicMajor
      additional?: unknown
    }
    module_author?: {
      mid?: number
      name?: string
      face?: string
      pub_ts?: number
      pub_action?: string
    }
    module_stat?: {
      comment?: { count: number }
      like?: { count: number }
      forward?: { count: number }
    }
  }
  [key: string]: unknown
}

export interface DynamicMajor {
  type?: string
  archive?: {
    aid?: string
    bvid?: string
    cover?: string
    title?: string
    desc?: string
    duration_text?: string
    stat?: { view?: string; danmaku?: string; like?: string }
  }
  opus?: {
    title?: string
    summary?: { text?: string }
    pics?: { url?: string }[]
  }
  draw?: {
    items?: { src?: string; width?: number; height?: number }[]
    title?: string
  }
  article?: unknown
  live_rcmd?: unknown
  [key: string]: unknown
}

/** 动态详情（/x/polymer/web-dynamic/v1/detail data） */
export interface DynamicDetail {
  item?: DynamicItem
  rel?: unknown[]
  [key: string]: unknown
}

/** 发送动态返回 */
export interface PublishDynamicResult {
  dynamic_id?: string
  dynamic_id_str?: string
}

/** 操作动态返回 */
export interface DynamicActionResult {
  toast?: string
  [key: string]: unknown
}
