import { BaseApi, type ParamValue } from './base.js'
import type { VideoDetail, PlayUrlData } from '../models/video.js'

export interface ViewParams {
  aid?: number
  bvid?: string
  cid?: number
  [key: string]: ParamValue
}

export interface PlayUrlParams {
  cid: number
  bvid?: string
  aid?: number
  qn?: number
  fnval?: number
  fnver?: number
  fourk?: number
  [key: string]: ParamValue
}

export interface VideoActionResult {
  like?: boolean
  dislike?: boolean
}

/** 视频相关接口 */
export class VideoApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x/web-interface'
  private static readonly PLAYER_HOST = 'https://api.bilibili.com/x/player'

  /** 视频详情（需 WBI 签名） */
  async view(params: ViewParams): Promise<VideoDetail> {
    return this.request('GET', `${VideoApi.WBI_HOST}/wbi/view`, { params, wbi: true })
  }

  /** 播放地址（需 WBI 签名，默认 4K + dash） */
  async playurl(params: PlayUrlParams): Promise<PlayUrlData> {
    const { qn = 120, fnval = 4048, fourk = 1, ...rest } = params
    return this.request('GET', `${VideoApi.PLAYER_HOST}/wbi/playurl`, {
      params: { ...rest, qn, fnval, fourk },
      wbi: true,
    })
  }

  /** 点赞 */
  async like(aid: number, like = true): Promise<VideoActionResult> {
    return this.postForm(`${VideoApi.WBI_HOST}/archive/like`, {
      aid,
      like: like ? 1 : 2,
    })
  }

  /** 三连（点赞+投币+收藏） */
  async triple(aid: number): Promise<VideoActionResult> {
    return this.postForm(`${VideoApi.WBI_HOST}/archive/like/triple`, { aid })
  }

  /** 投币 */
  async coin(aid: number, params?: { multiply?: number; select_like?: number }): Promise<unknown> {
    return this.postForm(`${VideoApi.WBI_HOST}/coin/add`, {
      aid,
      multiply: params?.multiply ?? 1,
      select_like: params?.select_like ?? 0,
    })
  }

  /** 收藏 */
  async addFavorite(aid: number, addFavIds: number[], delFavIds: number[] = []): Promise<unknown> {
    return this.postForm(`${VideoApi.WBI_HOST}/fav/video/add`, {
      rid: aid,
      add_media_ids: addFavIds.join(','),
      del_media_ids: delFavIds.join(','),
    })
  }

  /** 删除收藏 */
  async delFavorite(aid: number, addFavIds: number[] = [], delFavIds: number[]): Promise<unknown> {
    return this.postForm(`${VideoApi.WBI_HOST}/fav/video/del`, {
      rid: aid,
      add_media_ids: addFavIds.join(','),
      del_media_ids: delFavIds.join(','),
    })
  }

  /** 分享 */
  async share(aid: number): Promise<VideoActionResult> {
    return this.postForm(`${VideoApi.WBI_HOST}/share/add`, { aid })
  }

  /** 相关推荐 */
  async related(aid: number): Promise<VideoDetail[]> {
    return this.request('GET', `${VideoApi.WBI_HOST}/related/all`, {
      params: { aid },
      wbi: true,
    })
  }

  /** 稍后再看列表 */
  async toviewList(): Promise<{ count: number; list: unknown[] }> {
    return this.request('GET', `${VideoApi.WBI_HOST}/v2/history/toview/list`, {
      wbi: true,
      login: true,
    })
  }
}
