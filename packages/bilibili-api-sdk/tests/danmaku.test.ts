import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { parseDanmakuXml, decodeInflate } from '../src/api/danmaku.js'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<i>
    <chatserver>chat.bilibili.com</chatserver>
    <chatid>144541892</chatid>
    <mission>0</mission>
    <maxlimit>1500</maxlimit>
    <state>0</state>
    <real_name>0</real_name>
    <d p="490.19100,1,25,16777215,1584268892,0,a16fe0dd,29950852386521095">从结尾回来看这里，更感动了！</d>
    <d p="18.77300,4,36,16765698,1584268920,1,4fe08d3,29950867226492933">&lt;script&gt;实体转义&lt;/script&gt;</d>
</i>
`

describe('parseDanmakuXml', () => {
  it('解析元信息与弹幕项', () => {
    const { state, items } = parseDanmakuXml(SAMPLE_XML)
    expect(state).toBe(0)
    expect(items).toHaveLength(2)

    expect(items[0]).toMatchObject({
      time: 490.191,
      mode: 1,
      size: 25,
      color: 16777215,
      ctime: 1584268892,
      pool: 0,
      midHash: 'a16fe0dd',
      dmid: '29950852386521095',
      text: '从结尾回来看这里，更感动了！',
    })

    // 底部弹幕（mode 4）+ 字幕池（pool 1）+ 实体转义还原
    expect(items[1].mode).toBe(4)
    expect(items[1].size).toBe(36)
    expect(items[1].pool).toBe(1)
    expect(items[1].text).toBe('<script>实体转义</script>')
  })
})

describe('decodeInflate', () => {
  it('解压 zlib deflate（带头部）', () => {
    const bytes = new Uint8Array(deflateSync(Buffer.from(SAMPLE_XML, 'utf-8')))
    expect(decodeInflate(bytes)).toBe(SAMPLE_XML)
  })

  it('无法解压时按原文返回', () => {
    expect(decodeInflate(new TextEncoder().encode('<i>plain</i>'))).toBe('<i>plain</i>')
  })
})
