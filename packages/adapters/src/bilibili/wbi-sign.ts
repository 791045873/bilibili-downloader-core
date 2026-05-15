/**
 * WBI 签名算法
 *
 * 参考: downkyicore/DownKyi.Core/BiliApi/Sign/WbiSign.cs
 */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

/**
 * 从 img_key + sub_key 推导 mixin_key
 * 使用固定置换表取前 32 字符
 */
function getMixinKey(imgKey: string, subKey: string): string {
  const combined = imgKey + subKey;
  const result: string[] = [];
  for (let i = 0; i < 32; i++) {
    result.push(combined[MIXIN_KEY_ENC_TAB[i]]);
  }
  return result.join("");
}

/**
 * 对参数进行 WBI 签名
 * 添加 wts (时间戳) 和 w_rid (MD5(urlencoded_params + mixin_key))
 *
 * @param params - 原始参数对象
 * @param imgKey - WBI img_key
 * @param subKey - WBI sub_key
 * @returns 签名后的参数 (含 wts, w_rid)
 */
export async function wbiSign(
  params: Record<string, string | number | undefined>,
  imgKey: string,
  subKey: string,
): Promise<Record<string, string>> {
  const mixinKey = getMixinKey(imgKey, subKey);

  // 过滤 undefined 值，转换为字符串
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      filtered[k] = String(v);
    }
  }

  // 添加 wts (当前秒级时间戳)
  filtered["wts"] = String(Math.floor(Date.now() / 1000));

  // 按 key 排序
  const sortedKeys = Object.keys(filtered).sort();
  const queryParts: string[] = [];
  for (const key of sortedKeys) {
    // 过滤掉 !'()* 特殊字符
    const value = filtered[key].replace(/[!'()*]/g, "");
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  const queryString = queryParts.join("&");

  // 计算 w_rid = MD5(queryString + mixinKey)
  const wrid = await md5(queryString + mixinKey);

  filtered["w_rid"] = wrid;
  return filtered;
}

/**
 * MD5 哈希 (使用 Web Crypto API / Node crypto)
 */
async function md5(input: string): Promise<string> {
  // Node.js 环境
  if (typeof process !== "undefined") {
    const crypto = await import("node:crypto");
    return crypto.createHash("md5").update(input).digest("hex");
  }
  // 浏览器环境 (fallback)
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("MD5", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 从 Bilibili Nav API 获取 WBI Keys
 */
export function getWbiKeys(navData: {
  data: { wbi_img: { img_url: string; sub_url: string } };
}): WbiKeys {
  const imgUrl = navData.data.wbi_img.img_url;
  const subUrl = navData.data.wbi_img.sub_url;

  const imgKey = imgUrl.split("/").pop()?.split(".")[0] ?? "";
  const subKey = subUrl.split("/").pop()?.split(".")[0] ?? "";

  return { imgKey, subKey };
}