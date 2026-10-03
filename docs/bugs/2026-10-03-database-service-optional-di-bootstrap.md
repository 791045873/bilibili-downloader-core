# 2026-10-03 DatabaseService 构造参数缺 `@Optional()` → cloud-server / nas-worker 启动期 Nest DI 失败

## 症状
`pnpm dev:server`（以及任何 `node dist/main.js` 全量 bootstrap）启动时，cloud-server 与 nas-worker **都**在 Nest 实例化阶段崩溃：

```
UnknownDependenciesException: Nest can't resolve dependencies of the DatabaseService
(PrismaService, ?). Please make sure that the argument String at index [1] is available
in the DatabaseModule module.
```

typecheck / build / 各包 vitest 全绿，Stage C/D 的 closure audit 也通过——但应用从未真正 bootstrap 过，故未暴露。

## 根因
`packages/server-common/src/database/database.service.ts` 的构造签名（Stage A B2 引入 `DOWNLOAD_ROOT` 字符串注入时）：

```ts
constructor(prisma?: PrismaService, downloadRoot?: string) { ... }
```

TypeScript 的 `?:` 可选参数**不等于** Nest 的 `@Optional()`。`emitDecoratorMetadata` 为第二参发出 `String` 类型，Nest DI 据此尝试按类型解析一个 `String` provider，`DatabaseModule` 没有该 token → 抛 `UnknownDependenciesException`，整个 `AppModule` 实例化失败。`PrismaService`（index 0）可解析，故只卡在 index 1。

## 为什么全绿却没发现
- `tsc`/`nest build` 只做编译，不执行运行期 DI。
- 单测通过 `new DatabaseService(...)` 直接实例化（或测试模块显式 provider），**从不走 `NestFactory` 全量 bootstrap**，因此 DI 解析路径未被覆盖。
- Stage D 的容器验证只做了镜像构建 + 容器内静态检查 + `prisma db init`（prisma CLI，非 Nest 应用），也未真正 bootstrap 应用。
- 该缺陷自 Stage A B2 起潜伏；单体 `packages/server` 退役前未被全量启动，故一直到本次 `pnpm dev:server` 才首次触发。

## 修复
给 `downloadRoot` 参数加 `@Optional()`（从 `@nestjs/common` 导入）：

```ts
constructor(prisma?: PrismaService, @Optional() downloadRoot?: string) { ... }
```

Nest 据此在无 provider 时注入 `undefined`，恢复「未注入 → getter 读 `OUTPUT_DIR` env」的既有语义。纯 DI 元数据注解，对直接实例化（测试）零影响。

## 修复后状态
`pnpm dev:server`：cloud-server 与 nas-worker 均完整 bootstrap（所有 module 初始化、cloud 全部路由 mapped、DB 连接成功）。唯一剩余报错是**预期**的 schema 哨兵——dev 模式不跑 `prisma db init`，目标库无表时 `verifySchemaTables` 主动拒启（需先对该库跑一次 `prisma db init`）。

## 预防
- 任何经 Nest DI 装配、且构造参数含**非 class 类型**（string/number/boolean/接口）或可选依赖的 provider，必须显式 `@Optional()` 和/或 `@Inject(TOKEN)`。
- 关键回归面补一个「真实 `NestFactory` bootstrap 冒烟」用例（无需连库，mock 到 onModuleInit 之前即可），即可在 CI 捕获此类 DI 装配错误。
