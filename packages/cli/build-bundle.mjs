/**
 * 打包 CLI 为单文件可执行脚本
 * 需要全局安装 esbuild: npm install -g esbuild
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const outdir = "bin";
mkdirSync(outdir, { recursive: true });

execSync(
  `esbuild dist/index.js --bundle --platform=node --target=node18 --format=cjs --outfile=${outdir}/bili-dl.cjs --banner:js="#!/usr/bin/env node" --external:node:*`,
  { stdio: "inherit" },
);

// 修复双 shebang
let content = readFileSync(`${outdir}/bili-dl.cjs`, "utf-8");
const shebang = "#!/usr/bin/env node";
if (content.startsWith(shebang + "\n" + shebang)) {
  content = content.slice(shebang.length + 1);
  writeFileSync(`${outdir}/bili-dl.cjs`, content);
}

console.log(`✅ CLI 已打包为 bin/bili-dl.cjs`);