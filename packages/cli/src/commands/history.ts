/**
 * history 命令 - 查看下载历史
 */

import { Command } from "commander";
import { TaskStore } from "@bilibili-downloader/adapters/task-store";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_STORE = join(homedir(), ".bilibili-downloader", "tasks.json");

export function createHistoryCommand(): Command {
  return new Command("history")
    .alias("hist")
    .description("查看下载历史")
    .option("-s, --store <path>", "任务记录文件路径", DEFAULT_STORE)
    .option("-n, --limit <n>", "显示最近 N 条记录", "20")
    .option("--clear", "清空历史记录", false)
    .action(async (options) => {
      const store = new TaskStore(options.store);
      const limit = Number.parseInt(options.limit, 10);

      if (options.clear) {
        await store.clear();
        console.log("历史记录已清空");
        return;
      }

      const tasks = await store.findRecent(limit);

      if (tasks.length === 0) {
        console.log("暂无下载记录");
        return;
      }

      console.log(`\n下载历史 (最近 ${tasks.length} 条):\n`);
      for (const task of tasks) {
        const icon = task.status === "success" ? "✅" : "❌";
        const time = task.createdAt.split("T")[0];
        const duration = task.durationMs
          ? ` (${(task.durationMs / 1000).toFixed(1)}s)`
          : "";
        console.log(
          `${icon} ${time}  ${task.request.input}${duration}`,
        );
        if (task.outputFile) {
          console.log(`   → ${task.outputFile}`);
        }
        if (task.errorMessage) {
          console.log(`   ⚠ ${task.errorMessage}`);
        }
      }
    });
}