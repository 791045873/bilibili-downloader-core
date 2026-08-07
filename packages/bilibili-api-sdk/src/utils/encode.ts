/**
 * URL 编码工具，兼容 B 站 WBI 签名要求：
 * - 百分号编码使用大写十六进制（%E4%BA%94，而非 %e4%ba%94）
 * - 空格编码为 %20（而非 form 约定的 +）
 * 行为对齐 JS 标准 encodeURIComponent。
 */
export function encodeURIComponentCompat(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const code = input.charCodeAt(i)
    // 非转义字符：A-Z a-z 0-9 - _ . ! ~ * ' ( )
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      ch === '-' ||
      ch === '_' ||
      ch === '.' ||
      ch === '!' ||
      ch === '~' ||
      ch === '*' ||
      ch === "'" ||
      ch === '(' ||
      ch === ')'
    ) {
      out += ch
      continue
    }
    // 处理代理对
    let cp = code
    let len = 1
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        len = 2
      }
    }
    let bytes: number[]
    if (cp <= 0x7f) {
      bytes = [cp]
    } else if (cp <= 0x7ff) {
      bytes = [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
    } else if (cp <= 0xffff) {
      bytes = [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
    } else {
      bytes = [
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      ]
    }
    for (const b of bytes) {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
    }
    i += len - 1
  }
  return out
}

/** 过滤掉 value 中的 "!'()*" 字符（WBI 签名要求） */
export function filterWbiChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[!'()*]/g, '')
}
