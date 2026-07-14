# Screenshot Remote Support (3a) — Testing Directions

> 对应 plan: `docs/plans/2026-07-07-screenshot-remote-3a-plan.md`
> 对应需求: `docs/requirements/2026-07-07-screenshot-source-fallback-3a.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 `FfmpegScreenshot` 支持本地文件路径与 HTTP URL 两种输入，支持自定义 HTTP headers 用于远端流请求，且本地路径行为无回归。

## 测试方向

### 1. 本地路径无回归

**应成立:**
- 以本地文件路径调用 `takeScreenshots()`，行为与改动前完全一致（headers 被忽略，ffprobe/ffmpeg 无 `-headers` 参数）。
- 本地路径截图成功产出文件。

**不应成立:**
- 本地路径因新增 headers/remote 逻辑而失败或参数变化。

### 2. HTTP URL 参数构造

**应成立:**
- `videoPath` 以 `http://` 或 `https://` 开头时，进入 remote 模式。
- remote 模式且提供 `headers` 时，ffmpeg 命令参数含 `-headers`（格式 `"Key: value\r\n"` 拼接），插入在 `-i` 之前。
- remote 模式且提供 `headers` 时，ffprobe 参数也含 `-headers`。

**不应成立:**
- remote 模式下 headers 未传递给 ffmpeg/ffprobe。

### 3. ffprobe 失败处理

**应成立:**
- remote URL 下 ffprobe 失败时，`takeScreenshots()` 不抛异常，跳过 duration 检查（`videoDuration = Infinity`），继续截图流程。
- `screenshotFrame()` 失败时返回 false，不抛异常。

**不应成立:**
- remote URL ffprobe 失败导致整个 `takeScreenshots()` 抛异常中断。

### 4. 远端截图失败优雅降级

**应成立:**
- 远端截图失败（如 CDN URL 过期、403）时，`screenshotFrame()` 返回 false，`takeScreenshots()` 返回空或部分结果，不抛异常。

**不应成立:**
- 远端失败导致未捕获异常。

### 5. 远端 live CDN 截图通过

**应成立:**
- 使用真实 B 站视频（BV1SoTx6yEYc）解析出的流地址 + `headers={Referer: "https://www.bilibili.com"}`，`takeScreenshots({videoPath, timePoints:[5], headers})` 产出非空 `outputFiles`，每个文件存在且 size > 0。

**不应成立:**
- live CDN 截图无产出或文件为空。

## 范围外（由其他 plan 覆盖）

- `ScreenshotSourceResolver` 降级策略 —— 由 `2026-07-07-screenshot-fallback-3b` plan 覆盖。
- `AnalysisEngine` 截图源选择逻辑改动 —— 由 3b plan 覆盖。
- 截图时间点计算逻辑 —— 不变。

## 验证命令

- `pnpm typecheck` —— 零错误
- `pnpm build` —— 零错误
- 代码审查：local 分支无 headers/无 try/catch；remote 分支含 `-headers`；try/catch 包裹 `getVideoDuration`
- 内联验证脚本：BilibiliStreamProvider 解析 BV1SoTx6yEYc → takeScreenshots → 断言 outputFiles 非空

## 2026-07-14 Closure Verification Record

- `pnpm test:screenshot:no-cookie` 执行完成，exit code = 0
- 使用真实远端流 URL（低清晰度）调用 `takeScreenshots()` 成功生成截图
- 结果文件存在且 `size > 0`
- 结论：测试方向 1-5 均通过（方向 5 使用无 Cookie 等价远端验证路径）
