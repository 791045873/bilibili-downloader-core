# better-sqlite3 Node ABI Mismatch

## Symptom

运行 `pnpm --filter @bilibili-downloader/server start:dev` 时，server 在初始化 `DatabaseService` 阶段失败，报错类似：

```text
better_sqlite3.node was compiled against a different Node.js version using
NODE_MODULE_VERSION 120. This version of Node.js requires
NODE_MODULE_VERSION 137.
```

该错误会出现在 Nest 应用编译成功之后、数据库服务实例化时。

## Root Cause

`better-sqlite3` 是原生 Node 模块，`build/Release/better_sqlite3.node` 必须与当前运行 Node 的 ABI 版本一致。

本次项目切换到 Node `24.16.0` 后，当前运行时需要 `NODE_MODULE_VERSION 137`，但依赖目录中仍保留了之前 Node 版本编译出的 `better_sqlite3.node`（`NODE_MODULE_VERSION 120`）。因此当 `DatabaseService` 调用 `new Database(...)` 加载原生二进制时发生 `ERR_DLOPEN_FAILED`。

一个容易误判的点是：

```bash
pnpm --filter @bilibili-downloader/server exec node -e "require('better-sqlite3')"
```

只会加载 `better-sqlite3` 的 JS 包装层，不会立即加载原生 `.node` 文件。该命令通过并不代表 ABI 已修复。必须实例化数据库或启动 server 才能覆盖真实失败路径。

## Fix

在项目固定的 Node 版本下，对 server 依赖上下文中的 `better-sqlite3` 执行 rebuild：

```bash
pnpm --filter @bilibili-downloader/server rebuild better-sqlite3
```

本次 rebuild 使用 `node@24.16.0`、`node-gyp` 和本机 VS BuildTools 重新编译，最终重新生成：

```text
node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

## Why This Fix Is Correct

`pnpm --filter @bilibili-downloader/server rebuild better-sqlite3` 会在 server 包依赖图上下文中执行 `better-sqlite3` 的 install/build 脚本，从而用当前 Node 版本重新生成原生二进制。

项目已固定 Node 版本为 `24.16.0`，当前 ABI 为 `137`，重新编译后的 `.node` 文件与运行时 ABI 匹配。

## Verification

自动测试没有覆盖该问题，因为它发生在本机原生依赖二进制加载阶段，且当前项目没有 server 启动集成测试。手动验证如下：

```bash
node -p "process.version + ' modules=' + process.versions.modules"
pnpm --filter @bilibili-downloader/server exec node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close(); console.log('better-sqlite3 instantiate ok')"
pnpm --filter @bilibili-downloader/server start:dev
```

验证结果：

- Node 输出 `v24.16.0 modules=137`。
- `new Database(':memory:')` 成功，输出 `better-sqlite3 instantiate ok`。
- `start:dev` 成功完成 Nest 编译、连接 SQLite 数据库，并输出 `Nest application successfully started`。

## Prevention

- 切换 Node 大版本后，不要只运行 `require('better-sqlite3')` 作为验证；应运行 `new Database(':memory:')` 或实际启动 server。
- 当出现 `NODE_MODULE_VERSION` 不匹配时，优先在对应 workspace 包上下文执行 `pnpm --filter @bilibili-downloader/server rebuild better-sqlite3`。
- 项目应继续保留 `.node-version`、`.nvmrc`、`package.json` 的 `engines` 与 `volta` 配置，避免不同终端使用不同 Node 版本。
