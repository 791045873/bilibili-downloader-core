# @bilibili-downloader/cli

Bilibili 视频下载命令行工具。

## 安装

```bash
pnpm install
pnpm build
```

## 命令

### 下载视频

```bash
# 单视频
pnpm run download "BV11z536jELv"
pnpm run download "https://www.bilibili.com/video/BV11z536jELv/"

# 合集/收藏夹
pnpm run download "ml1329019876"
pnpm run download "https://www.bilibili.com/list/ml1329019876"
```

| 参数 | 说明 | 默认值 |
|---|---|---|
| `<input>` | BV号、AV号、URL或ml合集ID | (必填) |
| `-o, --output` | 输出目录 | `./downloads` |
| `-q, --quality` | 清晰度 qn值 | `80` (1080P) |
| `-c, --codec` | 编码偏好 (avc/hevc/av1) | 自动 |
| `--cookie-file` | Cookie文件路径 | - |
| `--keep-temp` | 失败时保留临时文件 | `false` |

### 登录

```bash
pnpm run login
```

终端显示二维码，使用 Bilibili 手机客户端扫码登录。Cookie 保存在 `~/.bilibili-downloader/cookies.json`。

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-o, --output` | Cookie 输出路径 | `~/.bilibili-downloader/cookies.json` |

## 前置依赖

- **Node.js** >= 18
- **ffmpeg** (用于音视频合并)，安装: `winget install ffmpeg`