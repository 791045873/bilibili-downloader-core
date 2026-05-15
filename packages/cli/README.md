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
pnpm download "BV11z536jELv"
pnpm download "https://www.bilibili.com/video/BV11z536jELv/"

# 合集/收藏夹
pnpm download "ml1329019876"
pnpm download "https://www.bilibili.com/list/ml1329019876"

# 下载带字幕
pnpm download "BV11z536jELv" --subtitle

# 下载指定分 P
pnpm download "BV11z536jELv" -p 3
```

| 参数 | 说明 | 默认值 |
|---|---|---|
| `<input>` | BV号、AV号、URL或ml合集ID | (必填) |
| `-o, --output` | 输出目录 | `./downloads` |
| `-q, --quality` | 清晰度 qn值 | `80` (1080P) |
| `-c, --codec` | 编码偏好 (avc/hevc/av1) | 自动 |
| `--cookie-file` | Cookie文件路径 | - |
| `--keep-temp` | 失败时保留临时文件 | `false` |
| `-p, --page <n>` | 下载指定分 P (1-based) | - |
| `--all-pages` | 下载全部分 P | `false` |
| `--downloader <type>` | 下载器: `http` / `aria2` | `http` |
| `--subtitle` | 同时下载字幕 (.srt) | `false` |
| `--log-file <path>` | 日志文件路径 | - |
| `--task-store <path>` | 任务记录文件路径 | `~/.bilibili-downloader/tasks.json` |

### 登录

```bash
pnpm login-bili
```

终端显示二维码，使用 Bilibili 手机客户端扫码登录。Cookie 保存在 `~/.bilibili-downloader/cookies.json`。

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-o, --output` | Cookie 输出路径 | `~/.bilibili-downloader/cookies.json` |

### 查看下载历史

```bash
pnpm history              # 查看最近 20 条
pnpm history --limit 5    # 查看最近 5 条
pnpm history --clear      # 清空历史
```

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-s, --store <path>` | 任务记录文件 | `~/.bilibili-downloader/tasks.json` |
| `-n, --limit <n>` | 显示条数 | `20` |
| `--clear` | 清空历史 | `false` |

### aria2 下载器 (可选)

```bash
# 先启动 aria2c 守护进程
aria2c --enable-rpc --rpc-listen-port=6800

# 使用 aria2 下载
pnpm download "BV11z536jELv" --downloader aria2
```

## 前置依赖

- **Node.js** >= 18
- **ffmpeg** (用于音视频合并), 安装: `winget install ffmpeg`
- **aria2** (可选, 用于多线程下载), 安装: `winget install aria2`