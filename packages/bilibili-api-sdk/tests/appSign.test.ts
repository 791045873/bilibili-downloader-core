import { describe, it, expect } from 'vitest'
import { appSign, appSignWith } from '../src/auth/appSign.js'

describe('appSign', () => {
  it('文档测试向量: android key, id=114514 & str=1919810 & test=いいよ，こいよ', () => {
    const appkey = '1d8b6e7d45233436'
    const appsec = '560c52ccd288fed045859ed18bffd973'
    const { sign } = appSign({ id: 114514, str: '1919810', test: 'いいよ，こいよ' }, appkey, appsec)
    expect(sign).toBe('01479cf20504d865519ac50f33ba3a7d')
  })

  it('签名输出 query 与文档一致', () => {
    const appkey = '1d8b6e7d45233436'
    const appsec = '560c52ccd288fed045859ed18bffd973'
    const { params, sign } = appSign({ id: 114514, str: '1919810', test: 'いいよ，こいよ' }, appkey, appsec)
    expect(sign).toBe('01479cf20504d865519ac50f33ba3a7d')
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
      .join('&')
    expect(sorted).toBe(
      'appkey=1d8b6e7d45233436&id=114514&sign=01479cf20504d865519ac50f33ba3a7d&str=1919810&test=%E3%81%84%E3%81%84%E3%82%88%EF%BC%8C%E3%81%93%E3%81%84%E3%82%88',
    )
  })

  it('appSignWith 使用预置 android key', () => {
    const { params } = appSignWith({ ts: 0 }, 'android')
    expect(params.appkey).toBe('1d8b6e7d45233436')
    expect(typeof params.sign).toBe('string')
    expect(params.sign).toHaveLength(32)
  })

  it('不同 key 组得到不同 sign', () => {
    const a = appSignWith({ ts: 0 }, 'android')
    const b = appSignWith({ ts: 0 }, 'tv')
    expect(a.sign).not.toBe(b.sign)
  })
})
