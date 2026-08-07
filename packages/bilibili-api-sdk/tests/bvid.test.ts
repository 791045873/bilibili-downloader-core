import { describe, it, expect } from 'vitest'
import { av2bv, bv2av, isBvid, isAid } from '../src/utils/bvid.js'

describe('av2bv / bv2av', () => {
  it('文档测试向量: av2bv(111298867365120) === BV1L9Uoa9EUx', () => {
    expect(av2bv(111298867365120)).toBe('BV1L9Uoa9EUx')
    expect(bv2av('BV1L9Uoa9EUx')).toBe(111298867365120)
  })

  it('文档测试向量: av2bv(170001) === BV17x411w7KC', () => {
    expect(av2bv(170001)).toBe('BV17x411w7KC')
    expect(bv2av('BV17x411w7KC')).toBe(170001)
  })

  it('互转保持一致（含边界值）', () => {
    for (const aid of [1, 2, 100, 99999999, 170001, 111298867365120]) {
      expect(bv2av(av2bv(aid))).toBe(aid)
    }
  })

  it('非法 bvid 抛错', () => {
    expect(() => bv2av('BV17x411w7K0')).toThrow()
    expect(() => bv2av('AV1xx')).toThrow()
  })
})

describe('isBvid / isAid', () => {
  it('识别合法 bvid', () => {
    expect(isBvid('BV1L9Uoa9EUx')).toBe(true)
    expect(isBvid('BV17x411w7KC')).toBe(true)
    expect(isBvid('av123')).toBe(false)
    expect(isBvid('')).toBe(false)
  })

  it('识别合法 avid', () => {
    expect(isAid('170001')).toBe(true)
    expect(isAid(170001)).toBe(true)
    expect(isAid('abc')).toBe(false)
    expect(isAid('1234567890123456')).toBe(false)
  })
})
