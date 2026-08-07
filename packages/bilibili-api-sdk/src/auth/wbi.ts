import { createHash } from 'node:crypto'
import { getMixinKey } from '../utils/mixinKeyTab.js'
import { encodeURIComponentCompat, filterWbiChars } from '../utils/encode.js'
import type { BilibiliHttp } from '../http/http.js'
import { BiliError } from '../errors.js'

export interface WbiKeys {
  imgKey: string
  subKey: string
  mixinKey: string
  fetchedAt: number
}

export type WbiParamValue = string | number | boolean | undefined | null

/** 从 nav 接口返回的 wbi_img 中提取 img_key / sub_key */
export function extractWbiKeysFromUrl(imgUrl: string, subUrl: string): { imgKey: string; subKey: string } {
  const imgKey = (imgUrl.split('/').pop() ?? '').split('.')[0]
  const subKey = (subUrl.split('/').pop() ?? '').split('.')[0]
  if (!imgKey || !subKey) throw new BiliError(-1, `解析 wbi_img 失败: ${imgUrl} / ${subUrl}`)
  return { imgKey, subKey }
}

/** 纯函数：为参数计算 wbi 签名（暴露便于单测） */
export function signWbi(
  params: Record<string, WbiParamValue>,
  imgKey: string,
  subKey: string,
  nowSec = Math.floor(Date.now() / 1000),
): Record<string, WbiParamValue> {
  const mixinKey = getMixinKey(imgKey, subKey)
  const signed: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    signed[k] = filterWbiChars(String(v))
  }
  signed.wts = String(nowSec)

  const query = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponentCompat(k)}=${encodeURIComponentCompat(signed[k])}`)
    .join('&')

  const wRid = createHash('md5').update(query + mixinKey).digest('hex')
  return { ...params, wts: nowSec, w_rid: wRid }
}

/** WBI key 管理器：拉取 / 缓存 / 刷新 */
export class WbiKeyManager {
  private keys: WbiKeys | null = null
  private refreshMs: number
  private pending: Promise<WbiKeys> | null = null

  constructor(refreshMs = 60 * 60 * 1000) {
    this.refreshMs = refreshMs
  }

  /** 强制刷新（忽略缓存） */
  async refresh(http: BilibiliHttp): Promise<WbiKeys> {
    const res = await http.get<{
      code: number
      message: string
      data: { wbi_img?: { img_url?: string; sub_url?: string } }
    }>('https://api.bilibili.com/x/web-interface/nav', {
      headers: { Referer: 'https://www.bilibili.com/' },
      retries: 2,
    })
    const body = res.body
    if (!body || (body.code !== 0 && body.code !== -101)) {
      throw new BiliError(body?.code ?? -1, `获取 WBI key 失败: ${body?.message ?? ''}`)
    }
    const imgUrl = body.data?.wbi_img?.img_url
    const subUrl = body.data?.wbi_img?.sub_url
    if (!imgUrl || !subUrl) throw new BiliError(-1, 'nav 响应缺少 wbi_img')
    const { imgKey, subKey } = extractWbiKeysFromUrl(imgUrl, subUrl)
    this.keys = { imgKey, subKey, mixinKey: getMixinKey(imgKey, subKey), fetchedAt: Date.now() }
    return this.keys
  }

  /** 按需获取（带缓存与并发去重） */
  async getKeys(http: BilibiliHttp, force = false): Promise<WbiKeys> {
    if (!force && this.keys && Date.now() - this.keys.fetchedAt < this.refreshMs) {
      return this.keys
    }
    if (!this.pending) {
      this.pending = this.refresh(http).finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  /** 为参数附加 wbi 签名 */
  async sign(
    http: BilibiliHttp,
    params: Record<string, WbiParamValue>,
    force = false,
  ): Promise<Record<string, WbiParamValue>> {
    const keys = await this.getKeys(http, force)
    return signWbi(params, keys.imgKey, keys.subKey)
  }

  /** 注入已知 key（便于复用持久化缓存） */
  setKeys(keys: Pick<WbiKeys, 'imgKey' | 'subKey'>, fetchedAt = Date.now()): void {
    this.keys = {
      ...keys,
      mixinKey: getMixinKey(keys.imgKey, keys.subKey),
      fetchedAt,
    }
  }

  get cached(): WbiKeys | null {
    return this.keys
  }
}
