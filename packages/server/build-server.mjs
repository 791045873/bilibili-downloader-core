/**
 * 打包 Web 服务器为单文件
 */

import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";

const outdir = "bin";
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["dist/server.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: `${outdir}/server.cjs`,
  banner: { js: "#!/usr/bin/env node" },
  external: ["node:*"],
  minify: false,
  sourcemap: false,
});

// 修复双 shebang (tsc 输出自带 + esbuild banner)
let content = readFileSync(`${outdir}/server.cjs`, "utf-8");
const shebang = "#!/usr/bin/env node";
if (content.startsWith(shebang + "\n" + shebang)) {
  content = content.slice(shebang.length + 1);
  writeFileSync(`${outdir}/server.cjs`, content);
}

// 复制 HTML 到 bin 目录，确保启动时能找到
copyFileSync("src/index.html", `${outdir}/index.html`);
copyFileSync("src/index.html", "dist/index.html");

console.log(`✅ Web 服务器已打包为 bin/server.cjs`);