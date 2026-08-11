import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const pythonDir = join(repoRoot, "packages", "server", "python");
const proxyScript = join(pythonDir, "qwen_vision_proxy.py");
const venvPython = process.platform === "win32"
  ? join(pythonDir, ".venv", "Scripts", "python.exe")
  : join(pythonDir, ".venv", "bin", "python");

const python = existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");
const pythonCmd = process.platform === "win32" ? `"${python}"` : python;
const proxyScriptCmd = process.platform === "win32" ? `"${proxyScript}"` : proxyScript;

const child = spawn(pythonCmd, [proxyScriptCmd], { stdio: "inherit", shell: process.platform === "win32" });

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
