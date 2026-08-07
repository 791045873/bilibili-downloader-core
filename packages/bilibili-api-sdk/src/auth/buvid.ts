import { randomUUID } from 'node:crypto'
import type { BilibiliHttp } from '../http/http.js'

/**
 * buvid3 / buvid4 生成与获取
 * 来源: bilibili-API-collect/docs/misc/buvid3_4.md
 * 优先通过 spi 接口获取真实 buvid；失败时本地生成（UUID+"infoc" 形式）。
 */
export async function fetchBuvid(
  http: BilibiliHttp,
): Promise<{ b_3: string; b_4: string }> {
  try {
    const res = await http.get<{
      code: number
      message: string
      data?: { b_3?: string; b_4?: string }
    }>('https://api.bilibili.com/x/frontend/finger/spi', {
      withCookie: false,
      headers: { Referer: 'https://www.bilibili.com/' },
      timeoutMs: 5000,
      retries: 0,
    })
    const data = res.body?.data
    if (data?.b_3) {
      return { b_3: data.b_3, b_4: data.b_4 ?? '' }
    }
  } catch {
    // 忽略，走本地生成
  }
  return { b_3: generateBuvid3(), b_4: '' }
}

/** 本地生成 buvid3（UUID + "infoc" 后缀，与 BiliPai 客户端一致） */
export function generateBuvid3(): string {
  return randomUUID() + 'infoc'
}
