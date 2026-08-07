import { BaseApi, cleanParams, type ParamValue } from './base.js'
import { BiliError } from '../errors.js'
import type { PlayUrlData } from '../models/video.js'

export interface PgcPlayUrlParams {
  cid: number
  bvid?: string
  aid?: number
  /** 番剧也可用 ep_id / season_id 取流 */
  ep_id?: number
  season_id?: number
  qn?: number
  fnval?: number
  fnver?: number
  fourk?: number
  [key: string]: ParamValue
}

/**
 * PGC 播放地址基类：番剧 (pgc) 与课程 (pugv)。
 * 与 UGC 不同，响应体数据位于 `result` 字段（部分接口为 `data`），
 * 且无需 WBI 签名。
 */
abstract class PgcPlayUrlApi extends BaseApi {
  protected abstract readonly host: string

  /** 获取播放地址（默认 4K + dash） */
  async playurl(params: PgcPlayUrlParams): Promise<PlayUrlData> {
    const { qn = 120, fnval = 4048, fnver = 0, fourk = 1, ...rest } = params
    const res = await this.http.get<{
      code: number
      message: string
      data?: PlayUrlData
      result?: PlayUrlData
    }>(`${this.host}/player/web/playurl`, {
      params: cleanParams({ ...rest, qn, fnval, fnver, fourk }),
      headers: { Referer: 'https://www.bilibili.com/' },
    })
    const body = res.body
    if (!body) throw new BiliError(-1, '空响应')
    if (body.code !== 0) throw new BiliError(body.code, body.message, body as never)
    const data = body.data ?? body.result
    if (!data) throw new BiliError(body.code, '响应缺少 data/result 字段', body as never)
    return data
  }
}

/** 番剧播放地址（pgc/player/web/playurl） */
export class BangumiApi extends PgcPlayUrlApi {
  protected readonly host = 'https://api.bilibili.com/pgc'
}

/** 课程播放地址（pugv/player/web/playurl） */
export class CheeseApi extends PgcPlayUrlApi {
  protected readonly host = 'https://api.bilibili.com/pugv'
}
