/**
 * 打包 Web 服务器为单文件
 * 需要全局安装 esbuild: npm install -g esbuild
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const outdir = "bin";
mkdirSync(outdir, { recursive: true });

execSync(
  `esbuild dist/server.js --bundle --platform=node --target=node18 --format=cjs --outfile=${outdir}/server.cjs --banner:js="#!/usr/bin/env node" --external:node:*`,
  { stdio: "inherit" },
);

// 修复双 shebang
let content = readFileSync(`${outdir}/server.cjs`, "utf-8");
const shebang = "#!/usr/bin/env node";
if (content.startsWith(shebang + "\n" + shebang)) {
  content = content.slice(shebang.length + 1);
  writeFileSync(`${outdir}/server.cjs`, content);
}

console.log(`✅ Web 服务器已打包为 bin/server.cjs`);