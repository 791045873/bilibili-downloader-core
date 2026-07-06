# Bilibili 视频字幕下载接口规范

> 本文档基于 DownKyi 项目的字幕下载逻辑整理，供其他语言开发者参考实现。
> 涵盖了从 Bilibili API 获取字幕到生成 SRT 文件的完整流程，不依赖任何特定语言或框架。

---

## 1. 概述

下载 Bilibili 视频字幕需要 **三个步骤**：

1. **Step A** — 调用 `PlayerV2` API（需 Wbi 签名），获取该视频 CID 对应的字幕元数据列表，每条记录包含一个 `subtitle_url`
2. **Step B** — 逐个下载 `subtitle_url` 指向的 JSON 字幕文件，解析后转换为标准 SRT 格式
3. **Step C** — 将 SRT 文本写入磁盘文件

**调用方必须提供的参数：**

| 参数 | 类型 | 说明 |
|---|---|---|
| `avid` | int64 | 视频 AV 号，可能为 0 |
| `bvid` | string? | 视频 BV 号，可能为 null |
| `cid` | int64 | 视频分 P 的 CID（必填） |
| `filePath` | string | 输出文件的路径前缀（不含扩展名），如 `/downloads/视频标题` |

**说明**：Bilibili 的视频标识有三个维度——`avid`（数字 AV 号）、`bvid`（字符串 BV 号）、`cid`（分 P 的唯一 ID）。同一个视频的 `avid` 和 `bvid` 是等价的二选一标识，而 `cid` 用于区分视频的不同分 P（多 P 视频的每一集）。调用 API 时需要同时提供 `cid` 和 `avid`/`bvid` 其中之一。

---

## 2. 数据模型定义

```
// ==================== PlayerV2 API 响应模型 ====================

// 顶层响应包装
STRUCT PlayerV2Origin:
    data: PlayerV2

// 播放器信息（核心字段）
STRUCT PlayerV2:
    aid: int64
    bvid: string
    cid: int64
    subtitle: SubtitleInfo?      // 可能为 null，表示无字幕信息

// 字幕信息包
STRUCT SubtitleInfo:
    allow_submit: bool
    lan: string
    lan_doc: string
    subtitles: List<Subtitle>

// 单条字幕条目（来自 PlayerV2 的 subtitles 列表）
STRUCT Subtitle:
    id: int64
    lan: string                        // 语言代码，如 "zh-CN"
    lan_doc: string                    // 语言描述，如 "中文（中国）"
    is_lock: bool
    author_mid: int64
    subtitle_url: string               // 协议相对 URL，如 "//i0.hdslb.com/bfs/xxx.json"
    type: int

// ==================== 字幕 JSON 文件模型 ====================

// 每个 subtitle_url 指向的 JSON 文件结构
STRUCT SubtitleJson:
    font_size: float
    font_color: string
    background_alpha: float
    background_color: string
    stroke: string
    body: List<SubtitleFragment>

// 单条字幕片段
STRUCT SubtitleFragment:
    from: float                        // 开始时间（秒），如 1.5
    to: float                          // 结束时间（秒），如 4.2
    location: int                      // 字幕位置枚举
    content: string                    // 字幕文本

// ==================== 输出模型 ====================

// 最终输出的字幕对象
STRUCT SubRipText:
    lan: string                        // 语言代码，透传自 Subtitle.lan
    lan_doc: string                    // 语言描述，透传自 Subtitle.lan_doc
    srt_string: string                 // 完整的 SRT 格式文本
```

---

## 3. Step A — 调用 PlayerV2 API 获取字幕元数据

### 3.1 Wbi 签名（必选前置步骤）

Bilibili 的 `x/player/wbi/v2` 接口需要 **Wbi 签名** 认证。签名算法如下：

```
FUNCTION WbiSign(parameters: Dictionary<string, object?>) -> Dictionary<string, string>
    // Step 1: 获取 img_key 和 sub_key
    // 这两个 key 来自登录后的用户信息，存储在本地
    (imgKey, subKey) = GetWbiKeys()

    // Step 2: 生成 mixin key
    mixinKey = GetMixinKey(imgKey + subKey)

    // Step 3: 添加时间戳
    parameters["wts"] = CurrentUnixTimestamp()

    // Step 4: 按 key 字典序排序
    sortedParams = SortByKey(parameters)

    // Step 5: 过滤 value 中的特殊字符 "!'()*"
    for each (key, value) in sortedParams:
        value = RemoveChars(value, "!'()*")

    // Step 6: 构建 URL 查询字符串（URL encoded）
    query = UrlEncode(sortedParams)

    // Step 7: 计算 w_rid（MD5）
    w_rid = MD5(query + mixinKey)

    // Step 8: 将 w_rid 和 wts 加入参数并返回
    sortedParams["w_rid"] = w_rid
    return sortedParams
END FUNCTION

FUNCTION GetMixinKey(origin: string) -> string
    // 固定的打乱索引表（硬编码，不可更改）
    mixinKeyEncTab = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
    ]
    temp = ""
    for each i in mixinKeyEncTab:
        temp += origin[i]
    return temp.substring(0, 32)  // 取前 32 个字符
END FUNCTION

FUNCTION GetWbiKeys() -> (string, string)
    // 从本地存储的用户信息中读取 img_key 和 sub_key
    // 这两个 key 在登录/刷新 Bilibili Cookie 时获取并持久化
    userInfo = LoadPersistedUserInfo()
    return (userInfo.img_key, userInfo.sub_key)
END FUNCTION
```

**`mixinKeyEncTab` 是硬编码的固定数组，不可修改。**

### 3.2 调用 API

```
FUNCTION PlayerV2(avid: int64, bvid: string?, cid: int64) -> PlayerV2?
    parameters = Dictionary<string, object?>()

    // avid 和 bvid 至少提供一个，建议两个都传
    IF avid > 0:
        parameters["avid"] = avid
    IF bvid != null:
        parameters["bvid"] = bvid
    IF cid > 0:
        parameters["cid"] = cid

    // 执行 Wbi 签名
    signedParams = WbiSign(parameters)

    // 构建 URL
    queryString = Join("&", signedParams.Map(kv => $"{kv.key}={kv.value}"))
    url = $"https://api.bilibili.com/x/player/wbi/v2?{queryString}"

    // HTTP 请求（GET）
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": "Mozilla/5.0 ...",
        "Cookie": "...",
        "Origin": "https://www.bilibili.com"
    }
    response = HttpGet(url, headers)

    // 解析 JSON 响应
    json = ParseJson(response)
    IF json["code"] != 0:
        RETURN null

    // 提取 data 字段
    data = json["data"]
    RETURN ParseToPlayerV2(data)
END FUNCTION
```

### 3.3 Cookie 说明

向 Bilibili API 发请求时必须携带以下 Cookie：

- **用户登录 Cookie**：`SESSDATA`、`bili_jct`、`DedeUserID` 等，从本地持久化存储读取
- **设备标识 Cookie**：`buvid3` 和 `buvid4`
  - 通过调用 `https://api.bilibili.com/x/frontend/finger/spi`（GET，无需任何参数）获取
  - 响应格式：`{ "data": { "b_3": "...", "b_4": "..." } }`
  - 获取后缓存，后续所有请求都带上

即使未登录，公开视频的字幕仍然可以下载，但**必须携带 `buvid3` / `buvid4`**。

### 3.4 重试机制

API 请求在遇到网络/HTTP 异常时应自动重试。建议：
- 普通 API 请求：最多重试 **2 次**（共发送 3 次请求）
- 下载类请求：最多重试 **5 次**

---

## 4. Step B — 下载字幕 JSON 并转换为 SRT

```
FUNCTION GetSubtitle(avid: int64, bvid: string?, cid: int64) -> List<SubRipText>?
    // 1. 调用 PlayerV2 获取播放器信息
    player = PlayerV2(avid, bvid, cid)
    IF player == null:
        RETURN empty list          // API 失败，返回空列表

    // 2. 检查是否有字幕信息
    IF player.subtitle == null OR player.subtitle.subtitles == null:
        RETURN empty list

    // 3. 字幕列表为空表示视频无字幕
    IF player.subtitle.subtitles.Count == 0:
        RETURN null                // 明确表示无字幕

    // 4. 遍历每个语言的字幕条目
    result = []
    FOR each sub in player.subtitle.subtitles:
        // 4a. 下载字幕 JSON 文件
        // 注意 sub.subtitle_url 是以 "//" 开头的协议相对 URL
        subtitleUrl = $"https:{sub.subtitle_url}"
        response = HttpGet(subtitleUrl, {
            "Referer": "https://www.bilibili.com"
        })

        // 4b. 解析 JSON
        subtitleJson = ParseJson(response)

        // 4c. 转换为 SRT 格式
        srtString = JsonToSrt(subtitleJson["body"])

        // 4d. 添加到结果列表
        result.append(SubRipText {
            lan: sub.lan,
            lan_doc: sub.lan_doc,
            srt_string: srtString
        })

    RETURN result
END FUNCTION
```

**JSON 转 SRT 算法：**

```
FUNCTION JsonToSrt(body: List<SubtitleFragment>) -> string
    srt = ""
    FOR i = 0; i < body.length; i++:
        item = body[i]
        // item.from 和 item.to 的单位是秒（float）
        startTime = SecondsToSrtTime(item.from)
        endTime = SecondsToSrtTime(item.to)
        content = item.content

        srt += $"{(i + 1)}\n"
        srt += $"{startTime} --> {endTime}\n"
        srt += $"{content}\n"
        srt += "\n"                  // SRT 条目间用空行分隔

    RETURN srt
END FUNCTION

FUNCTION SecondsToSrtTime(seconds: float) -> string
    IF seconds < 0:
        RETURN "00:00:00,000"

    hours = floor(seconds / 3600)
    minutes = floor((seconds % 3600) / 60)
    secs = floor(seconds % 60)
    millis = floor((seconds - floor(seconds)) * 1000)

    // SRT 格式使用逗号（,）作为毫秒分隔符，不是句点（.）
    RETURN Format("{0:D2}:{1:D2}:{2:D2},{3:D3}",
                  hours, minutes, secs, millis)
END FUNCTION
```

---

## 5. Step C — 写入 SRT 文件

```
FUNCTION DownloadSubtitle(avid: int64, bvid: string?, cid: int64,
                          filePath: string) -> List<string>?
    // 1. 获取所有字幕
    subRipTexts = GetSubtitle(avid, bvid, cid)

    // 2. 无字幕则返回 null
    IF subRipTexts == null OR subRipTexts.length == 0:
        RETURN null

    // 3. 逐个写入文件
    srtFiles = []
    FOR each subRip in subRipTexts:
        // 文件名格式：{文件路径}_{语言描述}.srt
        // 例如：/downloads/MyVideo_中文（中国）.srt
        srtFile = $"{filePath}_{subRip.lan_doc}.srt"
        WriteTextFile(srtFile, subRip.srt_string, encoding="UTF-8")
        srtFiles.append(srtFile)

    // 4. 复制第一个字幕为无后缀版本，用于播放器自动匹配
    // 例如：/downloads/MyVideo.srt
    IF srtFiles.length > 0:
        defaultSrtFile = $"{filePath}.srt"
        CopyFile(srtFiles[0], defaultSrtFile, overwrite=true)
        srtFiles.append(defaultSrtFile)

    RETURN srtFiles
END FUNCTION
```

---

## 6. API 端点汇总

| 用途 | 方法 | URL | 认证要求 |
|---|---|---|---|
| 获取播放器信息（含字幕元数据） | GET | `https://api.bilibili.com/x/player/wbi/v2?{wbi_signed_query}` | Wbi 签名 + Cookie |
| 获取 SPI 设备标识 | GET | `https://api.bilibili.com/x/frontend/finger/spi` | 无 |
| 下载字幕 JSON 文件 | GET | `https:{subtitle_url}` | Referer |

**HTTP 请求头：**

| Header | 值 |
|---|---|
| `Referer` | `https://www.bilibili.com` |
| `User-Agent` | 标准浏览器 UA（如 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...`） |
| `Origin` | `https://www.bilibili.com` |
| `Cookie` | 见 3.3 节 |
| `accept-language` | `zh-CN,zh;q=0.9` |

---

## 7. 边界情况与注意事项

| 场景 | 处理方式 |
|---|---|
| 视频无字幕 | `player.subtitle.subtitles` 为空列表，返回 null |
| 视频有字幕但某项语言下载失败 | 跳过该项，继续处理其他语言 |
| `subtitle_url` 以 `//` 开头（协议相对 URL） | 必须在前拼接 `https:` |
| PlayerV2 API 返回 null（网络/解析失败） | 返回空列表，不要抛出异常 |
| 文件写入失败 | 记录错误，继续处理下一个文件 |
| 字幕时间戳为负数 | 强制转换为 `00:00:00,000` |
| 多分 P 视频 | 每个分 P 有自己的 cid，分别调用本流程 |
| API 网络超时 / HTTP 异常 | 自动重试（API 类建议最多重试 2 次） |

---

## 8. 完整单步伪代码

```
// 输入：avid, bvid, cid, filePath
// 输出：已写入磁盘的 .srt 文件路径列表，无字幕则返回 null

List<string>? DownloadBilibiliSubtitles(int64 avid, string? bvid,
                                        int64 cid, string filePath):
    // Step 1: 获取字幕列表
    subRipTexts = GetSubtitle(avid, bvid, cid)
    if subRipTexts == null or subRipTexts.isEmpty():
        return null

    // Step 2: 写入文件
    srtFiles = []
    for subRip in subRipTexts:
        srtPath = filePath + "_" + subRip.lan_doc + ".srt"
        writeFile(srtPath, subRip.srt_string, encoding="UTF-8")
        srtFiles.add(srtPath)

    // Step 3: 复制一份无后缀版本用于播放器自动匹配
    if srtFiles.isNotEmpty():
        defaultPath = filePath + ".srt"
        copyFile(srtFiles[0], defaultPath, overwrite=true)
        srtFiles.add(defaultPath)

    return srtFiles
```

---

## 9. 所需技术能力

整个流程只需要以下基础能力，不依赖任何特定语言或框架：

| 能力 | 用途 |
|---|---|
| HTTP 客户端（GET，支持自定义 headers、Cookie、Referer） | 调用 Bilibili API 和下载 JSON 字幕文件 |
| JSON 解析器 | 解析 API 响应和字幕 JSON 文件 |
| MD5 哈希函数 | Wbi 签名计算 |
| 文件系统写入 | 将 SRT 写入磁盘 |
| 文件复制 | 生成无后缀版本字幕文件 |
