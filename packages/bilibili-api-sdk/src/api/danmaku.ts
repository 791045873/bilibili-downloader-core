import { inflateSync, inflateRawSync } from 'node:zlib'
import { BaseApi } from './base.js'

/** 弹幕属性（对应 XML <d p="..."> 属性） */
export interface DanmakuItem {
  /** 视频内出现时间（秒） */
  time: number
  /** 弹幕类型 */
  mode: number
  /** 字号 */
  size: number
  /** 颜色（十进制 RGB888） */
  color: number
  /** 发送时间戳 */
  ctime: number
  /** 弹幕池类型 */
  pool: number
  /** 发送者 mid 哈希 */
  midHash: string
  /** 弹幕唯一 id */
  dmid: string
  /** 内容 */
  text: string
  /** 屏蔽等级（可能缺失） */
  weight?: number
}

export interface DanmakuResult {
  state: number
  items: DanmakuItem[]
}

/**
 * 解析标准 XML 弹幕文本（defalte 解压后）。
 * 零依赖：用正则解析 <d p="...">text</d> 与元信息标签。
 */
export function parseDanmakuXml(xml: string): DanmakuResult {
  const stateMatch = /<state>(\d+)<\/state>/.exec(xml)
  const state = stateMatch ? Number(stateMatch[1]) : 0

  const items: DanmakuItem[] = []
  const dRegex = /<d p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g
  let m: RegExpExecArray | null
  while ((m = dRegex.exec(xml)) !== null) {
    const fields = m[1].split(',')
    const text = m[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    items.push({
      time: parseFloat(fields[0]),
      mode: parseInt(fields[1], 10),
      size: parseInt(fields[2], 10),
      color: parseInt(fields[3], 10),
      ctime: parseInt(fields[4], 10),
      pool: parseInt(fields[5] ?? '0', 10),
      midHash: fields[6] ?? '',
      dmid: fields[7] ?? '',
      weight: fields[8] !== undefined ? parseInt(fields[8], 10) : undefined,
      text,
    })
  }
  return { state, items }
}

/** 弹幕相关接口 */
export class DanmakuApi extends BaseApi {
  /** 实时弹幕（XML 接口，公开）。先尝试自动解压，再兜底手动 inflate。 */
  async realtime(cid: number): Promise<DanmakuResult> {
    const res = await this.http.get<Uint8Array>(
      `https://comment.bilibili.com/${cid}.xml`,
      { buffer: true, withCookie: false, retries: 2 },
    )
    const bytes = res.body
    return parseDanmakuXml(decodeInflate(bytes))
  }

  /** 历史弹幕日期索引（需登录，month 格式 YYYY-MM） */
  async historyIndex(cid: number, month: string): Promise<string[] | null> {
    return this.request('GET', 'https://api.bilibili.com/x/v2/dm/history/index', {
      params: { type: 1, oid: cid, month },
      login: true,
    })
  }

  /** 历史弹幕（需登录，date 格式 YYYY-MM-DD；XML 接口已废弃但可用） */
  async history(cid: number, date: string): Promise<DanmakuResult> {
    const res = await this.http.get<Uint8Array>('https://api.bilibili.com/x/v2/dm/history', {
      params: { type: 1, oid: cid, date },
      buffer: true,
      retries: 2,
    })
    return parseDanmakuXml(decodeInflate(res.body))
  }

  /** 历史弹幕 protobuf 段（返回原始 proto 字节，需自行按 proto 解析） */
  async historySeg(cid: number, date: string): Promise<Uint8Array> {
    const res = await this.http.get<Uint8Array>('https://api.bilibili.com/x/v2/dm/web/history/seg.so', {
      params: { type: 1, oid: cid, date },
      buffer: true,
      retries: 2,
    })
    return res.body
  }
}

/** deflate 解压：优先 zlib(带头)，失败回退 raw deflate（兼容 B 站旧实现） */
export function decodeInflate(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes)
  try {
    return inflateSync(buf).toString('utf-8')
  } catch {
    try {
      return inflateRawSync(buf).toString('utf-8')
    } catch {
      // 已由 undici 自动解压，直接按文本返回
      return buf.toString('utf-8')
    }
  }
}
