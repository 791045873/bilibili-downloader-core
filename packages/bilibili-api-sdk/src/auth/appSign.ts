import { createHash } from 'node:crypto'

export type AppKeyName = 'android' | 'android_hd' | 'tv' | 'ios' | 'web'

/** 常用 APPKey / APPSecret 对照表（来源: bilibili-API-collect/docs/misc/sign/APPKey.md） */
export const APP_KEYS: Record<AppKeyName, { appkey: string; appsec: string }> = {
  android: {
    appkey: '1d8b6e7d45233436',
    appsec: '560c52ccd288fed045859ed18bffd973',
  },
  android_hd: {
    appkey: 'dfca71928277209b',
    appsec: 'b5475a8825547a4fc26c7d518eaaa02e',
  },
  tv: {
    appkey: '4409e2ce8ffd12b8',
    appsec: '59b43e04ad6965f34319062b478f83dd',
  },
  ios: {
    appkey: 'YvirImLGlLANCLvM',
    appsec: 'JNlZNgfNGKZEpaDTkCdPQVXntXhuiJEM',
  },
  web: {
    appkey: '27eb53fc9058f8c3',
    appsec: 'c2ed53a74eeefe3cf99fbd01d8c9c375',
  },
}

export type AppParamValue = string | number | boolean | undefined | null

/** APP 签名算法：加 appkey -> key 排序 -> url 序列化 + appsec -> md5 */
export function appSign(
  params: Record<string, AppParamValue>,
  appkey: string,
  appsec: string,
): { params: Record<string, string | number | boolean>; sign: string } {
  const signed: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    signed[k] = String(v)
  }
  signed.appkey = appkey

  const query = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k])}`)
    .join('&')

  const sign = createHash('md5').update(query + appsec).digest('hex')
  return { params: { ...params, appkey, sign }, sign }
}

/** 便捷：使用预置 key 签名 */
export function appSignWith(
  params: Record<string, AppParamValue>,
  name: AppKeyName = 'android',
): { params: Record<string, string | number | boolean>; sign: string } {
  const { appkey, appsec } = APP_KEYS[name]
  return appSign(params, appkey, appsec)
}
