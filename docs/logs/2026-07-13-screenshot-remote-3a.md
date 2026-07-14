# 2026-07-13 Screenshot Remote Support (3a) 实现日志

## Plan
- `docs/plans/2026-07-07-screenshot-remote-3a-plan.md`

## 改动
- `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`:
  - `ScreenshotParams` 新增 `headers?: Record<string, string>` 字段
  - 新增 `isRemoteUrl()` 检测 `http://`/`https://` 前缀
  - 新增 `buildHeadersArg()` 将 headers 对象转为 ffmpeg `-headers` 格式（`"Key: value\r\n"` 拼接）
  - `takeScreenshots()`: remote URL 时 try/catch 包裹 `getVideoDuration()`，失败回退 `Infinity` 跳过 duration 检查
  - `screenshotFrame()`: remote + headers 时在 `-i` 前插入 `-headers` 参数
  - `probeVideoDuration()`: 有 headers 时在 ffprobe 参数前插入 `-headers`
  - `screenshotFrame()`: ffmpeg exit code 为 0 后使用 `stat()` 确认输出是非空文件，否则返回 false
  - 本地路径行为保持兼容（headers 被忽略，ffprobe/ffmpeg 输入参数与改动前一致）

## 验证
- `pnpm typecheck`: 全 6 包 Done（输出文件校验修复后重新通过）
- `pnpm build`: 全 6 包 Done（输出文件校验修复后重新通过）
- 代码审查确认:
  - 本地分支: `isRemote=false` → `buildHeadersArg` 返回 null → 无 `-headers`，args 与原始一致
  - remote 分支: try/catch 包裹 `getVideoDuration`，回退 `Infinity`
  - ffmpeg args: `-headers` 在 `-i` 前
  - ffprobe args: `-headers` 在 URL 前

## SubAgent 审查与修复
- 独立深度审查发现 P1：截图成功仅判断 exit code，未按需求确认文件存在且非空；已通过 `stat()` 修复
- 独立深度审查发现 P1：live CDN 验证未完成时 plan/backlog 提前标记完成；已恢复为 `in-progress`，closure gates 保持开放

## 未验证（阻塞关闭）
- 测试方向 #5（live CDN 截图）需 B站 cookies（`COOKIE_FILE` 或 cookie string），当前 `.env` 无 cookie 配置
- 配置 cookies 并运行 plan Phase 2 验证脚本后，仍需执行最终 cold-replay closure audit

## 备注
- `AnalysisEngine` 调用 `takeScreenshots()` 时未传 `headers`，向后兼容
- 3b plan 将消费此能力实现 `ScreenshotSourceResolver` 远端降级路径

## 2026-07-14 关闭记录
- 人工审查结论：允许关闭 3a plan
- 执行 `pnpm test:screenshot:no-cookie`，exit code = 0
- 远端截图（低清晰度流，无 Cookie）成功，输出文件存在且 `size > 0`
- 已同步更新：
  - `docs/plans/2026-07-07-screenshot-remote-3a-plan.md` → Plan Status: `done`
  - `docs/testing/2026/07-07-screenshot-remote-3a-testing.md` → 方向 1-5 通过
  - `docs/backlog/README.md` → Seq 2 (3a) 状态 `done`
