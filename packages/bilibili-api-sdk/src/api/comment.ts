import { BaseApi } from './base.js'
import {
  CommentSort,
  CommentType,
  type ReplyActionResult,
  type ReplyAddResult,
  type ReplyList,
} from '../models/comment.js'

export interface ReplyListParams {
  oid: number
  type?: CommentType
  pn?: number
  ps?: number
  sort?: CommentSort
}

/** 评论相关接口 */
export class CommentApi extends BaseApi {
  private static readonly WBI_HOST = 'https://api.bilibili.com/x'

  /** 评论列表（可按热度/时间/点赞排序） */
  async list(params: ReplyListParams): Promise<ReplyList> {
    return this.request('GET', `${CommentApi.WBI_HOST}/v2/reply/main`, {
      params,
    })
  }

  /** 评论详情（指定 rpid 拉取子回复，需要 cookie 或游客） */
  async detail(oid: number, rpid: number, type: CommentType = CommentType.VIDEO): Promise<ReplyList> {
    return this.request('GET', `${CommentApi.WBI_HOST}/v2/reply/main`, {
      params: { oid, rpid, type },
    })
  }

  /** 发表评论（需登录） */
  async add(oid: number, message: string, type: CommentType = CommentType.VIDEO, root?: number): Promise<ReplyAddResult> {
    return this.postForm(`${CommentApi.WBI_HOST}/v2/reply/add`, {
      oid,
      type,
      message,
      root,
    })
  }

  /** 删除评论（需登录，且为本人） */
  async del(rpid: number, oid: number, type: CommentType = CommentType.VIDEO): Promise<unknown> {
    return this.postForm(`${CommentApi.WBI_HOST}/v2/reply/del`, {
      oid,
      type,
      rpid,
    })
  }

  /** 点赞 / 取消点赞评论 */
  async like(rpid: number, oid: number, like: boolean, type: CommentType = CommentType.VIDEO): Promise<ReplyActionResult> {
    return this.postForm(`${CommentApi.WBI_HOST}/v2/reply/action`, {
      oid,
      type,
      rpid,
      action: like ? 1 : 2,
    })
  }
}
