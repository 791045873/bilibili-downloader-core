import { BaseApi } from './base.js'
import type {
  MedalWall,
  RelationList,
  RelationAttr,
  CardResult,
  UserCardBrief,
  NavInfo,
  SpaceAccInfo,
  SpaceArcSearchData,
  SeasonsSeriesListData,
  SeasonsArchivesListData,
} from '../models/user.js'

export interface SpaceRelationParams {
  vmid: number
  ps?: number
  pn?: number
  order?: 'desc' | 'asc'
}

export interface SpaceArcSearchParams {
  mid: number
  pn?: number
  ps?: number
  tid?: number
  keyword?: string
  order?: 'pubdate' | 'click' | 'stow'
  platform?: string
  web_location?: number
  [key: string]: string | number | boolean | undefined | null
}

/** 用户相关接口 */
export class UserApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x/web-interface'
  private static readonly SPACE_HOST = 'https://api.bilibili.com/x/space'
  private static readonly POLYMER_HOST = 'https://api.bilibili.com/x/polymer/web-space'

  /** 导航栏信息（含 WBI key、登录状态；未登录返回 isLogin=false 不抛错） */
  async nav(): Promise<NavInfo> {
    return this.fetchNav<NavInfo>()
  }

  /** 用户卡片（含等级/粉丝/关注数，公开） */
  async card(mid: number): Promise<CardResult> {
    return this.request('GET', `${UserApi.WBI_HOST}/card`, {
      params: { mid },
      wbi: true,
    })
  }

  /** 批量用户信息（最多 20 个 mid） */
  async cards(mids: number[]): Promise<Record<string, UserCardBrief>> {
    return this.request('GET', 'https://api.bilibili.com/x/polymer/pc-electron/v1/user/cards', {
      params: { mids: mids.join(',') },
    })
  }

  /** 粉丝勋章墙 */
  async medalWall(targetId: number): Promise<MedalWall> {
    return this.request('GET', 'https://api.live.bilibili.com/xlive/web-ucenter/user/MedalWall', {
      params: { target_id: targetId },
      headers: { Referer: 'https://live.bilibili.com/' },
    })
  }

  /** 关注列表（需要登录） */
  async following(params: SpaceRelationParams): Promise<RelationList> {
    return this.request('GET', `${UserApi.WBI_HOST}/wbi/relation/followings`, {
      params,
      wbi: true,
      login: true,
    })
  }

  /** 粉丝列表（需要登录） */
  async followers(params: SpaceRelationParams): Promise<RelationList> {
    return this.request('GET', `${UserApi.WBI_HOST}/wbi/relation/followers`, {
      params,
      wbi: true,
      login: true,
    })
  }

  /** 关注用户 */
  async follow(mid: number, mode: typeof RelationAttr[keyof typeof RelationAttr] = 2): Promise<unknown> {
    return this.postForm(`${UserApi.WBI_HOST}/relation/modify`, {
      fid: mid,
      act: 1,
      re_src: 11,
      mode,
    })
  }

  /** 取关用户 */
  async unfollow(mid: number): Promise<unknown> {
    return this.postForm(`${UserApi.WBI_HOST}/relation/modify`, {
      fid: mid,
      act: 2,
      re_src: 11,
    })
  }

  /** 用户空间基本信息（需 WBI 签名） */
  async accInfo(mid: number): Promise<SpaceAccInfo> {
    return this.request('GET', `${UserApi.SPACE_HOST}/wbi/acc/info`, {
      params: { mid },
      wbi: true,
    })
  }

  /** 用户空间投稿搜索（需 WBI 签名） */
  async spaceArcSearch(params: SpaceArcSearchParams): Promise<SpaceArcSearchData> {
    const {
      tid = 0,
      keyword = '',
      order = 'pubdate',
      platform = 'web',
      web_location = 1550101,
      ...rest
    } = params
    return this.request('GET', `${UserApi.SPACE_HOST}/wbi/arc/search`, {
      params: { ...rest, tid, keyword, order, platform, web_location },
      wbi: true,
    })
  }

  /** 用户合集/系列列表（需 WBI 签名） */
  async seasonsSeriesList(mid: number, pageNum = 1, pageSize = 20): Promise<SeasonsSeriesListData> {
    return this.request('GET', `${UserApi.POLYMER_HOST}/seasons_series_list`, {
      params: { mid, page_num: pageNum, page_size: pageSize },
      wbi: true,
    })
  }

  /** 合集内视频列表 */
  async seasonsArchivesList(
    seasonId: number,
    pageNum = 1,
    pageSize = 20,
  ): Promise<SeasonsArchivesListData> {
    return this.request('GET', `${UserApi.POLYMER_HOST}/seasons_archives_list`, {
      params: { season_id: seasonId, page_num: pageNum, page_size: pageSize },
    })
  }
}
