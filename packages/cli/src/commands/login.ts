/**
 * login 命令 - 二维码登录 B 站
 */

import { Command } from "commander";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import qrcode from "qrcode-terminal";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_COOKIE_FILE = join(
  homedir(),
  ".bilibili-downloader",
  "cookies.json",
);

export function createLoginCommand(): Command {
  return new Command("login")
    .description("通过二维码登录 B 站，保存 Cookie")
    .option(
      "-o, --output <path>",
      "Cookie 输出文件路径",
      DEFAULT_COOKIE_FILE,
    )
    .action(async (options) => {
      const { output } = options;
      const auth = new BilibiliAuthProvider();

      try {
        console.log("正在获取登录二维码...");

        const qrResult = await auth.generateQrCode();

        // 在终端显示二维码
        console.log("\n请使用 Bilibili 手机客户端扫描以下二维码:\n");
        qrcode.generate(qrResult.url, { small: true });

        console.log("\n等待扫码...");

        // 轮询扫码状态
        const pollInterval = 1500; // 1.5 秒轮询一次
        const maxPollTime = 3 * 60 * 1000; // 最长 3 分钟
        const startTime = Date.now();

        while (Date.now() - startTime < maxPollTime) {
          await sleep(pollInterval);
          const status = await auth.pollQrStatus(qrResult.qrcodeKey);

          switch (status.status) {
            case "pending":
              // 继续等待
              break;

            case "scanned":
              console.log("  已扫码，请在手机上确认登录...");
              break;

            case "expired":
              console.error(`\n二维码已过期: ${status.message}`);
              process.exit(1);

            case "confirmed": {
              // 登录成功，提取 Cookie
              const cookies = auth.extractCookies(status.callbackUrl);
              await auth.saveCookies(cookies, output);

              console.log(`\n登录成功! Cookie 已保存到: ${output}`);
              console.log(`  包含 ${cookies.length} 个 Cookie`);

              // 显示关键 Cookie
              const keyNames = ["DedeUserID", "SESSDATA", "bili_jct"];
              for (const key of keyNames) {
                const cookie = cookies.find((c) => c.name === key);
                if (cookie) {
                  const masked =
                    cookie.value.length > 10
                      ? cookie.value.slice(0, 6) + "...."
                      : "***";
                  console.log(`  ${key}: ${masked}`);
                }
              }
              return;
            }
          }
        }

        console.error("\n登录超时 (3 分钟)");
        process.exit(1);
      } catch (err) {
        console.error(`登录失败: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}