import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { getMixinKey } from '../src/utils/mixinKeyTab.js'
import { signWbi, extractWbiKeysFromUrl } from '../src/auth/wbi.js'

const IMG_KEY = '7cd084941338484aae1ad9425b84077c'
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45'

describe('getMixinKey', () => {
  it('文档测试向量: 得到 mixin_key ea1db124af3c7062474693fa704f4ff8', () => {
    expect(getMixinKey(IMG_KEY, SUB_KEY)).toBe('ea1db124af3c7062474693fa704f4ff8')
  })
})

describe('signWbi', () => {
  it('文档测试向量: foo/bar/zab + wts=1702204169 -> w_rid=8f6f2b5b...', () => {
    const signed = signWbi({ foo: '114', bar: '514', zab: '1919810' }, IMG_KEY, SUB_KEY, 1702204169)
    expect(signed.wts).toBe(1702204169)
    expect(signed.w_rid).toBe('8f6f2b5b3d485fe1886cec6a0be8c5d4')
  })

  it('按 key 排序后编码（空格 %20、中文大写百分号）', () => {
    // 文档示例: foo='one one four', bar='五一四', baz=1919810
    // 应编码为 bar=%E4%BA%94%E4%B8%80%E5%9B%9B&baz=1919810&foo=one%20one%20four
    const signed = signWbi({ foo: 'one one four', bar: '五一四', baz: 1919810 }, IMG_KEY, SUB_KEY, 1)
    expect(signed.w_rid).toBeDefined()
    const mixinKey = 'ea1db124af3c7062474693fa704f4ff8'
    const query = `bar=${encodeURIComponent('五一四')}&baz=1919810&foo=one%20one%20four&wts=1`
    expect(signed.w_rid).toBe(createHash('md5').update(query + mixinKey).digest('hex'))
  })

  it('过滤 value 中的 "!\'()*" 字符', () => {
    const signed = signWbi({ key: "a'b(c)d*e!f" }, IMG_KEY, SUB_KEY, 2)
    // 过滤后 key=abcdef
    const expected = createHash('md5').update(`key=abcdef&wts=2ea1db124af3c7062474693fa704f4ff8`).digest('hex')
    expect(signed.w_rid).toBe(expected)
  })
})

describe('extractWbiKeysFromUrl', () => {
  it('从 img_url/sub_url 提取文件名', () => {
    const { imgKey, subKey } = extractWbiKeysFromUrl(
      'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    )
    expect(imgKey).toBe(IMG_KEY)
    expect(subKey).toBe(SUB_KEY)
  })
})
