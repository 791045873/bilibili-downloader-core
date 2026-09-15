# QA 移动端适配 Testing Directions

- Linked Plan: `docs/plans/2026-09-14-qa-mobile-adaptation-plan.md`
- Source Requirement: `docs/requirements/2026-09-14-qa-mobile-adaptation.md`
- Owner Doc: `docs/design/app-overview.md`
- Status: 全部 `pending`（实施后逐条确认）

## Environment / Configuration Notes

- 前端：`pnpm --filter @bilibili-downloader/frontend dev`（或 `pnpm frontend:dev`），浏览器 DevTools 设备模拟 + 真机各一轮。
- 设备矩阵（至少覆盖）：
  - 宽度：360 / 375 / 390 / 430px 竖屏；≥768px 桌面。
  - 浏览器：iOS Safari、Android Chrome、桌面 Chrome（DevTools 响应式）。
  - 键盘：软键盘弹出/收起；安全区设备（刘海屏/Home 指示条）。
- 依赖状态：需连接可用后端以加载会话与回答；无命中时可走兜底文案验证渲染。

## Testing Directions

### D1 顶栏窄屏可达性

- Covers: 共享顶栏响应式折叠
- Should be observable: `< 768px` 顶栏不横向溢出，出现汉堡入口；展开后可见全部导航项与登录入口；点"穿搭问答"可进入 `/qa` 且抽屉关闭。
- Should not be observable: 导航项被裁切/换行，出现页面级横向滚动条，无法通过 UI 到达 QA 页。
- Status: pending
- Evidence: 待执行

### D2 桌面顶栏一致性

- Covers: 桌面端不回归
- Should be observable: `≥ 768px` 顶栏仍为横向 logo + 导航 + 登录，与改造前一致。
- Should not be observable: 桌面出现汉堡按钮或导航重排。
- Status: pending
- Evidence: 待执行

### D3 QA 窄屏单列与抽屉会话管理

- Covers: QA 页移动端主从布局
- Should be observable: `< 768px` 聊天区占满宽度；"会话列表"入口可打开抽屉；可新建/切换/删除会话；选中会话后抽屉关闭且内容正确；当前会话在列表中高亮；删除需二次确认。
- Should not be observable: 固定宽度侧栏挤压聊天区；切换会话后内容错乱或抽屉不关闭。
- Status: pending
- Evidence: 待执行

### D4 QA 桌面双栏一致性

- Covers: 桌面端不回归
- Should be observable: `≥ 768px` 仍为左侧会话列表 + 右侧聊天区双栏，行为与改造前一致。
- Should not be observable: 桌面下会话列表进入抽屉。
- Status: pending
- Evidence: 待执行

### D5 动态高度与软键盘

- Covers: 高度模型与键盘适配
- Should be observable: 消息区内部滚动；软键盘弹出/收起后输入框与发送按钮始终可见可操作；发送/聚焦后滚动到最新但不整页跳动。
- Should not be observable: 底部输入区被地址栏或键盘遮挡；页面出现整页抖动或滚动位置异常。
- Status: pending
- Evidence: 待执行

### D6 安全区适配

- Covers: 安全区
- Should be observable: 带安全区设备上，底部输入区不被 Home 指示条遮挡；顶部内容不被刘海遮挡。
- Should not be observable: 输入区或顶栏内容被系统 UI 覆盖。
- Status: pending
- Evidence: 待执行

### D7 回车语义按指针区分

- Covers: 触屏输入交互
- Should be observable: 触屏（粗指针）回车换行、发送走按钮；鼠标（细指针）回车发送、Shift+回车换行。
- Should not be observable: 触屏上回车导致误发送；鼠标上回车无法发送。
- Status: pending
- Evidence: 待执行

### D8 触控目标与二次确认

- Covers: 触控可用性
- Should be observable: 发送、照片、会话列表入口、会话删除等控件触屏可准确点按；删除有二次确认。
- Should not be observable: 控件过小导致误触或难以点中；删除无确认直接生效。
- Status: pending
- Evidence: 待执行

### D9 内容溢出防护

- Covers: 窄屏内容自适应
- Should be observable: 待发照片 chip 换行；用户照片、助手回复示例图缩略图条、视频来源、超长单词/URL 均在窄屏内换行/自适应，无横向溢出。
- Should not be observable: 气泡、图片卡片或页面出现横向滚动。
- Status: pending
- Evidence: 待执行

### D10 QA 既有功能等价

- Covers: 功能不删减
- Should be observable: 移动端可完成文本问答、照片问答（≤3 张）、多轮追问、三段式渲染（正文 `[n]` + 图片示例 + 视频注脚），来源 `?t=` 跳转正确；空态/加载态/发送中/失败可重试均可用。
- Should not be observable: 移动端缺失任一桌面能力；三段式内容或来源跳转错乱。
- Status: pending
- Evidence: 待执行

### D11 其他页面无回归

- Covers: 壳层改动的跨界面影响
- Should be observable: 首页、下载队列、AI 总结任务、提示词、设置、登录在窄屏与桌面均可正常打开、可滚动、无明显布局破损。
- Should not be observable: 任一页面因顶栏/高度模型改动而打不开、内容被裁切或无法滚动。
- Status: pending
- Evidence: 待执行

### D12 横竖屏切换

- Covers: 方向变化下的布局与高度
- Should be observable: 竖屏↔横屏切换后 QA 布局、聊天高度与输入区仍正确；会话内容不丢失。
- Should not be observable: 切换后输入区被遮挡、消息区高度错乱或内容被重置。
- Status: pending
- Evidence: 待执行

### D13 系统大字体

- Covers: 放大字体下的可用性
- Should be observable: 系统字体放大后文本正常换行、控件不重叠，核心操作仍可完成。
- Should not be observable: 文字溢出容器、按钮被挤出屏幕或相互覆盖。
- Status: pending
- Evidence: 待执行

### D14 回复图片加载失败降级

- Covers: 图片边界态
- Should be observable: 回复图片加载失败时显示占位降级，不影响文本与来源展示。
- Should not be observable: 图片失败导致消息区布局坍塌或抛出可见错误。
- Status: pending
- Evidence: 待执行

### D15 仅有图片或仅有文字的消息

- Covers: 消息边界态
- Should be observable: 仅图片无文字、仅文字无图片两种消息均正常展示；空内容与无照片时发送按钮禁用。
- Should not be observable: 空气泡、空白消息或误发送空消息。
- Status: pending
- Evidence: 待执行

### D16 照片上限禁用态

- Covers: 照片数量约束
- Should be observable: 达到 3 张上限后照片控件禁用且状态可见；删除待发照片或发送后可重新选择。
- Should not be observable: 超过 3 张仍可加入、或达到上限后无任何反馈。
- Status: pending
- Evidence: 待执行

### D17 会话数量多时抽屉滚动

- Covers: 会话列表可用性
- Should be observable: 会话数量较多时抽屉列表可独立滚动并定位目标会话。
- Should not be observable: 列表不可滚动、会话被抽屉底部裁切无法选中。
- Status: pending
- Evidence: 待执行

### D18 助手回复示例图缩略图与全屏查看

- Covers: 回复示例图展示与查看
- Should be observable: 同一条回答的示例图以横向并排缩略图条展示，缩略图不含文字；点击任一张进入全屏查看，可用左右滑动或内置左右按钮/键盘方向键切换同组其余图片；全屏展示当前图的技巧标题与说明；单张时无左右切换/滑动；缩略图与全屏加载失败均有占位降级；桌面与移动端形态一致。
- Should not be observable: 缩略图仍显示标题/说明文字；点击无法进入全屏；多图无法用滑动/按钮/键盘左右切换，或切换到其他回答的图片；单张出现空的切换控件；关闭全屏后聊天滚动位置或输入区异常。
- Status: pending
- Evidence: 待执行

### D19 全屏左右滑动手势

- Covers: 滑动切换与缩放手势仲裁
- Should be observable: 未放大时左滑显示下一张、右滑显示上一张，与按钮/键盘切换结果一致；首张不能左滑、末张不能右滑（不循环）；图片放大后横向拖动为平移查看，不触发切换；轻微或纵向为主的滑动不误切。
- Should not be observable: 滑动方向与切换方向相反；首/末循环切换；放大平移时误切图片；轻微/斜向触摸导致跳张；滑动与内置缩放互相打架导致图片错位或无法操作。
- Status: pending
- Evidence: 待执行
