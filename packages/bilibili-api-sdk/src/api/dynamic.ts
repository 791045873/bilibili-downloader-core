import { BaseApi } from './base.js'
import type {
  DynamicActionResult,
  DynamicDetail,
  PublishDynamicResult,
  SpaceDynamicFeed,
} from '../models/dynamic.js'

/** 动态相关接口 */
export class DynamicApi extends BaseApi {
  private static readonly HOST = 'https://api.bilibili.com/x/polymer/web-dynamic/v1'

  /** 他人空间动态流（分页用 offset） */
  async spaceFeed(hostMid: number, options?: { offset?: string; timezoneOffset?: number }): Promise<SpaceDynamicFeed> {
    return this.request('GET', `${DynamicApi.HOST}/feed/space`, {
      params: {
        host_mid: hostMid,
        offset: options?.offset,
        timezone_offset: options?.timezoneOffset ?? -480,
        features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
      },
      headers: {
        'x-bilibili-device': 'android',
        'web-req-json': 'true',
      },
    })
  }

  /** 动态详情 */
  async detail(id: string): Promise<DynamicDetail> {
    return this.request('GET', `${DynamicApi.HOST}/detail`, {
      params: { id },
      headers: { 'web-req-json': 'true' },
    })
  }

  /** 发布纯文本动态（需登录） */
  async publish(dynSrc?: string): Promise<PublishDynamicResult> {
    return this.postForm(`${DynamicApi.HOST}/create`, {
      web_location: '333.999',
      dyn_src: dynSrc ?? 'web.create.dynamic',
    })
  }

  /** 删除动态 */
  async delete(dynIds: string[]): Promise<DynamicActionResult> {
    return this.postForm('https://api.bilibili.com/x/dynamic/delete', {
      dynamic_ids: JSON.stringify(dynIds),
    })
  }

  /** 点赞 / 取消点赞动态 */
  async like(dynId: string, like: boolean): Promise<DynamicActionResult> {
    return this.postForm(`${DynamicApi.HOST}/thumbUp`, {
      dyn_id_str: dynId,
      up: like ? 1 : 0,
    })
  }
}
