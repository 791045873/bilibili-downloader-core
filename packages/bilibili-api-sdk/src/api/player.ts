import { BaseApi } from './base.js'
import type { PlayerV2Data } from '../models/player.js'

export interface PlayerV2Params {
  cid: number
  bvid?: string
  aid?: number
  [key: string]: string | number | boolean | undefined | null
}

/** 播放器信息接口（字幕等） */
export class PlayerApi extends BaseApi {
  private static readonly HOST = 'https://api.bilibili.com/x/player'

  /** 播放器信息 V2（需 WBI 签名，返回字幕列表等） */
  async playerV2(params: PlayerV2Params): Promise<PlayerV2Data> {
    return this.request('GET', `${PlayerApi.HOST}/wbi/v2`, {
      params,
      wbi: true,
      referer: 'https://www.bilibili.com/',
    })
  }
}
