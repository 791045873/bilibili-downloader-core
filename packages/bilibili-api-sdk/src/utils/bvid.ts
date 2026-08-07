/**
 * bvid / avid 互转
 *
 * 来源: bilibili-API-collect/docs/misc/bvid_desc.md（新版算法）
 * 测试向量: av2bv(111298867365120) === 'BV1L9Uoa9EUx'
 */
const XOR_CODE = 23442827791579n
const MASK_CODE = 2251799813685247n
const MAX_AID = 1n << 51n
const BASE = 58n

const DATA =
  'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'

/** avid -> bvid */
export function av2bv(aid: number): string {
  const bytes = ['B', 'V', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0']
  let bvIndex = bytes.length - 1
  let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE
  while (tmp > 0) {
    bytes[bvIndex] = DATA[Number(tmp % BASE)]
    tmp = tmp / BASE
    bvIndex -= 1
  }
  ;[bytes[3], bytes[9]] = [bytes[9], bytes[3]]
  ;[bytes[4], bytes[7]] = [bytes[7], bytes[4]]
  return bytes.join('')
}

/** bvid -> avid */
export function bv2av(bvid: string): number {
  if (!bvid.startsWith('BV1')) {
    throw new Error(`无效的 bvid: ${bvid}`)
  }
  const arr = Array.from(bvid)
  ;[arr[3], arr[9]] = [arr[9], arr[3]]
  ;[arr[4], arr[7]] = [arr[7], arr[4]]
  const body = arr.slice(3)
  let tmp = 0n
  for (const ch of body) {
    const idx = DATA.indexOf(ch)
    if (idx < 0) {
      throw new Error(`bvid 包含非法字符: ${ch}`)
    }
    tmp = tmp * BASE + BigInt(idx)
  }
  return Number((tmp & MASK_CODE) ^ XOR_CODE)
}

/** 判断字符串是否为合法 bvid */
export function isBvid(value: string): boolean {
  return /^BV1[A-Za-z0-9]{9}$/.test(value)
}

/** 判断字符串是否为合法 avid（可为纯数字字符串或数字） */
export function isAid(value: string | number): boolean {
  return /^\d{1,15}$/.test(String(value))
}
