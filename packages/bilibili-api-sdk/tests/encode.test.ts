import { describe, it, expect } from 'vitest'
import { encodeURIComponentCompat, filterWbiChars } from '../src/utils/encode.js'

describe('encodeURIComponentCompat', () => {
  it('与原生 encodeURIComponent 对常规输入一致', () => {
    const cases = ['foo bar', 'hello=world', 'a&b=c', '中文测试', 'éç', '1/2', 'x.y-z_a']
    for (const s of cases) {
      expect(encodeURIComponentCompat(s)).toBe(encodeURIComponent(s))
    }
  })

  it('空格编码为 %20 而非 +', () => {
    expect(encodeURIComponentCompat('one one four')).toBe('one%20one%20four')
    expect(encodeURIComponentCompat('one one four')).not.toContain('+')
  })

  it('百分号使用大写十六进制', () => {
    expect(encodeURIComponentCompat('五一四')).toBe('%E4%BA%94%E4%B8%80%E5%9B%9B')
    expect(encodeURIComponentCompat('いいよ，こいよ')).toBe(
      '%E3%81%84%E3%81%84%E3%82%88%EF%BC%8C%E3%81%93%E3%81%84%E3%82%88',
    )
  })

  it('代理对（emoji）正确编码', () => {
    expect(encodeURIComponentCompat('🚀')).toBe('%F0%9F%9A%80')
    expect(encodeURIComponentCompat('🚀')).toBe(encodeURIComponent('🚀'))
  })

  it('保留字不转义: !~*\'()', () => {
    expect(encodeURIComponentCompat("a!b~c*d'e(f)g")).toBe("a!b~c*d'e(f)g")
  })
})

describe('filterWbiChars', () => {
  it('移除 !\'()* 字符', () => {
    expect(filterWbiChars("a'b(c)d*e!f")).toBe('abcdef')
  })
})
