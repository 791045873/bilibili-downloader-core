import { BaseApi } from './base.js'
import {
  FavFolder,
  FavFolderList,
  FavMedia,
  FavOrder,
  type FavDealResult,
  type FavResourceList,
} from '../models/favorite.js'

export interface FavResourceListParams {
  mediaId: number
  pn?: number
  ps?: number
  order?: FavOrder
  type?: number
  platform?: string
}

/** 收藏夹相关接口 */
export class FavoriteApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x'

  /** 收藏夹详情 */
  async folderInfo(mediaId: number, upMid?: number): Promise<FavFolder> {
    return this.request('GET', `${FavoriteApi.WBI_HOST}/v3/fav/folder/info`, {
      params: { media_id: mediaId, up_mid: upMid },
    })
  }

  /** 收藏夹内容列表 */
  async resourceList(params: FavResourceListParams): Promise<FavResourceList> {
    const { mediaId, ...rest } = params
    return this.request('GET', `${FavoriteApi.WBI_HOST}/v3/fav/resource/list`, {
      params: { media_id: mediaId, ...rest },
    })
  }

  /** 用户创建的全部收藏夹 */
  async createdListAll(upMid: number, options?: { rid?: number }): Promise<FavFolderList> {
    return this.request('GET', `${FavoriteApi.WBI_HOST}/v3/fav/folder/created/list-all`, {
      params: { up_mid: upMid, rid: options?.rid ?? 3 },
    })
  }

  /** 批量操作收藏（add/del） */
  async deal(rid: number, addMediaIds: number[], delMediaIds: number[] = []): Promise<FavDealResult> {
    return this.postForm(`${FavoriteApi.WBI_HOST}/v3/fav/resource/deal`, {
      rid,
      type: 2,
      add_media_ids: addMediaIds.join(','),
      del_media_ids: delMediaIds.join(','),
    })
  }

  /** 收藏视频 */
  async addVideo(aid: number, folderIds: number[]): Promise<FavDealResult> {
    return this.deal(aid, folderIds)
  }

  /** 取消收藏视频 */
  async removeVideo(aid: number, folderIds: number[]): Promise<FavDealResult> {
    return this.postForm(`${FavoriteApi.WBI_HOST}/v3/fav/resource/deal`, {
      rid: aid,
      type: 2,
      add_media_ids: '',
      del_media_ids: folderIds.join(','),
    })
  }

  /** 视频是否已收藏（返回收藏夹列表） */
  async isFav(aid: number): Promise<{ count: number; list: FavMedia[] }> {
    return this.request('GET', `${FavoriteApi.WBI_HOST}/v2/fav/video/favoured`, {
      params: { aid },
      login: true,
    })
  }
}
