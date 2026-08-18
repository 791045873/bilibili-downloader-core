import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const pythonDir = join(repoRoot, "packages", "vision-proxy");
const proxyScript = join(pythonDir, "qwen_vision_proxy.py");
const venvPython =
  process.platform === "win32"
    ? join(pythonDir, ".venv", "Scripts", "python.exe")
    : join(pythonDir, ".venv", "bin", "python");

const python = existsSync(venvPython)
  ? venvPython
  : process.platform === "win32"
    ? "python"
    : "python3";
const pythonCmd = process.platform === "win32" ? `"${python}"` : python;
const proxyScriptCmd = process.platform === "win32" ? `"${proxyScript}"` : proxyScript;

const NO_RESTART = process.env.VISION_PROXY_NO_RESTART === "1";
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const RESET_UPTIME_MS = 60000;

let shuttingDown = false;
let child = null;
let delayMs = BASE_DELAY_MS;

function scheduleRestart() {
  if (shuttingDown || NO_RESTART) return;
  const nextDelay = delayMs;
  delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  process.stderr.write(
    `[start-vision-proxy] proxy is down; restarting in ${nextDelay}ms\n`,
  );
  setTimeout(start, nextDelay);
}

function start() {
  let proc;
  try {
    proc = spawn(pythonCmd, [proxyScriptCmd], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } catch (err) {
    process.stderr.write(`[start-vision-proxy] spawn failed: ${err.message}\n`);
    if (NO_RESTART || shuttingDown) {
      process.exit(1);
      return;
    }
    scheduleRestart();
    return;
  }
  child = proc;
  const startedAt = Date.now();

  proc.on("exit", (code, signal) => {
    if (child === proc) child = null;
    if (shuttingDown || NO_RESTART) {
      process.exit(code ?? (signal ? 1 : 0));
      return;
    }
    if (Date.now() - startedAt >= RESET_UPTIME_MS) {
      delayMs = BASE_DELAY_MS;
    }
    process.stderr.write(
      `[start-vision-proxy] proxy exited (code=${code}, signal=${signal})\n`,
    );
    scheduleRestart();
  });
}

function shutdown() {
  shuttingDown = true;
  if (child) child.kill();
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
