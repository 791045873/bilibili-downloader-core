import { describe, it, expect } from 'vitest'
import { CommentType, CommentSort } from '../src/models/comment.js'
import { QrStatus } from '../src/models/login.js'
import { SearchType, SearchOrder } from '../src/models/search.js'
import { FavOrder, FavAction } from '../src/models/favorite.js'
import { RelationAttr } from '../src/models/user.js'
import { VideoQuality, FnVal, VideoCodec, AudioQuality, VIDEO_ZONE } from '../src/models/video.js'

describe('模型枚举常量', () => {
  it('CommentType / CommentSort', () => {
    expect(CommentType.VIDEO).toBe(1)
    expect(CommentType.DYNAMIC).toBe(17)
    expect(CommentSort.BY_HOT).toBe(1)
  })

  it('QrStatus', () => {
    expect(QrStatus.SUCCESS).toBe(0)
    expect(QrStatus.NOT_SCANNED).toBe(86101)
    expect(QrStatus.SCANNED_NOT_CONFIRMED).toBe(86090)
    expect(QrStatus.EXPIRED).toBe(86038)
  })

  it('SearchType / SearchOrder', () => {
    expect(SearchType.VIDEO).toBe('video')
    expect(SearchOrder.CLICK).toBe('click')
  })

  it('FavOrder / FavAction', () => {
    expect(FavOrder.MTIME).toBe('mtime')
    expect(FavAction.ADD).toBe(1)
  })

  it('RelationAttr', () => {
    expect(RelationAttr.MUTUAL).toBe(6)
    expect(RelationAttr.BLOCKED).toBe(128)
  })

  it('VideoQuality / FnVal / VideoCodec', () => {
    expect(VideoQuality.Q1080P).toBe(80)
    expect(FnVal.DASH).toBe(16)
    expect(VideoCodec.HEVC).toBe(12)
    expect(AudioQuality.Q64K).toBe(30216)
    expect(VIDEO_ZONE[4]).toBe('游戏')
  })
})
