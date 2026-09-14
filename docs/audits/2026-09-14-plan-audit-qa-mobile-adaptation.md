# Plan Audit — QA 穿搭问答页移动端适配（含共享顶栏壳层）

- 计划：`docs/plans/2026-09-14-qa-mobile-adaptation-plan.md`
- 需求来源：`docs/requirements/2026-09-14-qa-mobile-adaptation.md`
- 测试方向：`docs/testing/2026/09-14-qa-mobile-adaptation-testing.md`
- 审计日期：2026-09-14
- 审计方式：独立 subagent（两轮冷启动，对照 live 代码与计划编写规则）
  - 首轮：task `ses_f60f8fc64ffeXOINeSFtYJ0BZO`
  - 复审：task `ses_f60f607ebffe2WHMKpGjo6PkeP`

## 首轮审计结论

`needs revision`

### 阻断问题（5 项）

1. `Decision` 项未定稿：高度模型与顶栏折叠仍写"间定稿"，缺少选定方案（违反计划指南 rule 9）。高度模型为跨界面决策，未定稿会带来共享壳层返工。
2. 软键盘无 iOS 策略：`dvh` 在 iOS Safari 键盘下不可靠，仅靠动态视口无法满足"键盘弹收后输入区可见可操作"。
3. 安全区顶部内边距与固定顶栏高度未计入；且 `7.5rem` 与实际 `6.5rem`（3.5rem + 3rem）存在偏差，固定偏移会裁切/溢出。
4. testing 方向缺横竖屏、系统大字体、回复图片加载失败降级、照片上限禁用态、仅有图片/仅有文字、会话多时抽屉滚动等状态。
5. 反 slack：`补充移动端主题色等基础 meta（可选项按最小改动落地）` 含禁词"可选项"，且未在需求基线中授权。

### 其余非阻断问题

- 基线引用行号不精确（消息滚动区应为 `QaChat.tsx:231`、输入区 `:261`）；漏记用户照片 `width={120}`（`:326`）与 `AiSummaryTasks.tsx:886` 的 `max-h-[calc(100vh-150px)]`。
- Targets 中"必要时"属模糊措辞。
- 未声明保护区域不涉及（登录入口移入抽屉，涉及 auth 区域）。
- closure audit 独立性表述不清。

## 修订

- 三个 `Decision` 全部定稿并写明选择理由、备选、残余风险：顶栏折叠=汉堡+Drawer；高度模型=壳层顶栏实测高度变量 + QA 局部消费动态视口（不切换其他全宽页滚动）；窄屏首屏=自动选中最近会话 + 抽屉入口。
- 需求补充软键盘策略（Android `interactive-widget=resizes-content` + 动态视口；iOS `visualViewport`），并明确"两端不承诺像素级一致"。
- 高度计算式计入顶栏实测高度（含顶部安全区）并量化 `7.5rem`/`6.5rem` 偏差；其他全宽页保留文档级滚动。
- testing 文档新增 D12–D17 覆盖横竖屏、大字体、图片失败降级、仅有图片/文字、照片上限禁用态、抽屉长列表滚动；计划 Phase 3 退出条件与 D 编号对齐。
- 删除模糊项，`theme-color` 定为品牌色 `#f43f5e` 并纳入需求基线。
- 修正基线行号与遗漏项，去除"必要时"，补充保护区域不涉及声明与 closure audit 独立性规则。

## 复审结论

`pass`。五项阻断全部消解，未引入新阻断项，基线引用与 live 代码一致，计划仍正确归类为跨界面完整审计（非 micro-plan）。

### 复审确认

- 三个 Decision 均含选择 + 备选 + 残余风险；需求 Open Question 1/2 已定稿。
- iOS 软键盘策略已写入需求与计划。
- 安全区顶部内边距与 `7.5rem`/`6.5rem` 偏差已量化并纳入决策。
- D12–D17 补齐，覆盖需求 Edge Cases。
- 无禁词残留；`theme-color` 已具体化。

### 复审非阻断建议（已吸收）

1. 需求中 `main` 垂直内边距措辞改为"`py-6`，上下共 3rem，与宽度无关"。
2. "顶栏保持固定高度"改为"高度稳定（不因换行改变；实际高度随顶部安全区变化，由实测值暴露）"。

## 规则符合性确认

- 计划结构与计划指南一致：Current Baseline（来自 live 仓库）、Goals/Non-Goals、分阶段执行（含 `Fix/Add/Decision/Proof` 标注）、各阶段 Exit Criteria、Closure Gates、Plan Audit、Deferred But Adjudicated、Closure。
- 跨界面变更分类正确：`Audit: required`，micro-plan exception 不适用。
- 反 slack：in-scope 项无禁词；Deferred 项（其他页面后续适配）写明重开条件。
- testing 方向覆盖需求验收标准与边界态，停留在需求可观测层。
- 不新增依赖（antd 6 Drawer/Grid、Tailwind 4 已具备）；不触及 API/数据模型/鉴权/部署。

## 事实核查

Current Baseline 关键声明与 live 代码一致（两轮抽查通过）：`App.tsx:20` 全宽路径集合、`App.tsx:34-76` 顶栏与 `main`、`QaChat.tsx:183/231/261/326/335/343/350/293-298/262-270/216-222`、`index.html:5`、`main.css`、`Home.tsx:78`、`ParseResult.tsx:250`、`AiSummaryTasks.tsx:886`、`package.json` 依赖版本。

## 状态

阻断问题两轮内消解，计划进入 `passed`，可进入实施阶段。

## 追加审计 — 助手回复示例图方案细化（2026-09-14）

- 触发：用户要求把助手回复示例图改为"横向缩略图条 + 点击全屏左右切换"。
- 方式：独立 subagent 聚焦复审，task `ses_f60e7bfd4ffeEpYsaUOEYolc1N`。

### 首轮结论

`needs revision`，2 项阻断：

1. 桌面范围矛盾：需求同时声称"桌面端行为不变"（Goal/AC/Non-Goal）与"桌面端同样采用该形态"，实现者可能两边都满足却各自验收失败。
2. "左右滑动切换"与安装版能力不符：已核实 antd 6.6.0 的 `Image.PreviewGroup` 仅提供左右按钮与键盘方向键导航（`@rc-component/image` `Preview/index.js:319`），滑动手势需自研。

### 修订

- 统一为"桌面与移动端采用同一形态；桌面端布局与顶栏不变"；Non-Goal 增补例外与"自定义滑动手势"出界。
- 切换方式明确为内置左右按钮/键盘方向键，滑动列入 Non-Goals；Plan Decision/Fix、需求 Flow/Business Rule/Edge Case、testing D18 同步更新。
- 补充实现细节风险：`items` 不携带 caption（按 `onChange` 索引映射）、缩略图 key 用索引避免同 URL 冲突。

### antd 能力核实

`Image.PreviewGroup` 存在于 antd 6.6.0（`packages/frontend/node_modules/antd/es/image/index.d.ts`、`PreviewGroup.d.ts`），单图自动隐藏左右切换（`@rc-component/image` `Preview/index.js:76`）。无需新增依赖；不承诺滑动手势。

### 修订后

两项阻断已按修复项消解；剩余为文档一致性修正，无契约/数据/跨界面边界变化。计划维持 `passed`，可进入实施。

## 关闭审计

本计划尚未实施；closure audit 将在计划关闭时独立执行（优先独立 subagent，非保护区域且无未解决产品风险时允许 cold-replay 自检），证据另行归档。
