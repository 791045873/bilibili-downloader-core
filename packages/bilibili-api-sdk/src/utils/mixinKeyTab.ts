/**
 * WBI 签名重排映射表 (MIXIN_KEY_ENC_TAB)
 *
 * 来源: bilibili-API-collect/docs/misc/sign/wbi.md
 */
export const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
]

/** 对 img_key+sub_key 打乱重排，取前 32 位得到 mixin_key */
export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey
  let out = ''
  for (let i = 0; i < 32; i++) {
    out += raw[MIXIN_KEY_ENC_TAB[i]]
  }
  return out
}
