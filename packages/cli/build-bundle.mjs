/**
 * 打包 CLI 为单文件可执行脚本
 */

import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const outdir = "bin";
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: `${outdir}/bili-dl.cjs`,
  banner: { js: "#!/usr/bin/env node" },
  external: ["node:*"],
  minify: false,
  sourcemap: false,
});

// 修复双 shebang
let content = readFileSync(`${outdir}/bili-dl.cjs`, "utf-8");
const shebang = "#!/usr/bin/env node";
if (content.startsWith(shebang + "\n" + shebang)) {
  content = content.slice(shebang.length + 1);
  writeFileSync(`${outdir}/bili-dl.cjs`, content);
}

console.log(`✅ CLI 已打包为 bin/bili-dl.cjs`);