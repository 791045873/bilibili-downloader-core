import { spawnSync } from "node:child_process";

const result = spawnSync("ffmpeg", ["-version"], {
  stdio: "ignore",
  shell: process.platform === "win32",
});

if (result.status === 0) {
  console.log("FFmpeg 已安装，可用于音视频合并。");
  process.exit(0);
}

console.warn([
  "FFmpeg 未安装或不在 PATH 中。",
  "下载后的音视频合并依赖 FFmpeg；请运行 pnpm setup 自动检查/安装，或手动安装 FFmpeg。",
].join("\n"));

process.exit(0);
