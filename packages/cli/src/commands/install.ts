/**
 * install 命令 - 检查并安装依赖工具 (ffmpeg, aria2)
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import { platform } from "node:os";

const isWin = platform() === "win32";

export function createInstallCommand(): Command {
  return new Command("install")
    .description("检查并安装依赖工具 (ffmpeg, aria2)")
    .option("--ffmpeg-only", "仅检查/安装 ffmpeg", false)
    .option("--aria2-only", "仅检查/安装 aria2", false)
    .action(async (options) => {
      const deps: { name: string; cmd: string; wingetId: string }[] = [];

      if (!options.aria2Only) {
        deps.push({ name: "ffmpeg", cmd: "ffmpeg", wingetId: "Gyan.FFmpeg" });
      }
      if (!options.ffmpegOnly) {
        deps.push({
          name: "aria2",
          cmd: "aria2c",
          wingetId: "aria2.aria2",
        });
      }

      console.log("检查依赖工具...\n");

      for (const dep of deps) {
        const ok = await checkCommand(dep.cmd);
        console.log(`  ${dep.name.padEnd(12)} ${ok ? "✅ 已安装" : "❌ 未安装"}`);

        if (!ok && isWin) {
          console.log(`    正在通过 winget 安装...`);
          try {
            execSync(
              `winget install --id "${dep.wingetId}" --source winget --accept-package-agreements --silent`,
              { stdio: "inherit", timeout: 180000 },
            );
            console.log(`    ✅ ${dep.name} 安装完成\n`);
          } catch {
            console.log(
              `    ❌ 安装失败，请手动执行: winget install --id "${dep.wingetId}"\n`,
            );
          }
        } else if (!ok) {
          console.log(
            `    → 请使用包管理器安装 (brew install / apt install)\n`,
          );
        }
      }
    });
}

async function checkCommand(cmd: string): Promise<boolean> {
  try {
    if (isWin) {
      execSync(`where.exe ${cmd}`, { stdio: "ignore" });
    } else {
      execSync(`which ${cmd}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}