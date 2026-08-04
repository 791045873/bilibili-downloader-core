import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const requirementsPath = join(repoRoot, "packages", "server", "python", "requirements.txt");
const isPostinstall = process.argv.includes("--postinstall");

if (!existsSync(requirementsPath)) {
  console.warn(`未找到 vision proxy 的 requirements 文件: ${requirementsPath}`);
  process.exit(0);
}

const candidates = process.platform === "win32"
  ? [
      { command: "python", args: [] },
      { command: "py", args: ["-3"] },
    ]
  : [
      { command: "python3", args: [] },
      { command: "python", args: [] },
    ];

function canRun(command, args) {
  const result = spawnSync(command, [...args, "--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  return result.status === 0;
}

const python = candidates.find((candidate) => canRun(candidate.command, candidate.args));

if (!python) {
  console.warn([
    "未检测到可用的 Python 解释器，已跳过 vision proxy Python 依赖安装。",
    "如需启用本地视觉代理，请先安装 Python 3，然后运行 pnpm setup:vision-proxy。",
  ].join("\n"));
  process.exit(0);
}

const installArgs = [...python.args, "-m", "pip", "install", "-r", requirementsPath];

console.log(
  isPostinstall
    ? `正在为 vision proxy 安装 Python 依赖: ${python.command} ${installArgs.join(" ")}`
    : `开始安装 vision proxy Python 依赖: ${python.command} ${installArgs.join(" ")}`,
);

const installResult = spawnSync(python.command, installArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (installResult.status === 0) {
  console.log("vision proxy Python 依赖已就绪。");
  process.exit(0);
}

console.warn([
  "vision proxy Python 依赖安装失败。",
  `请检查 pip / 网络环境后重试: ${python.command} ${installArgs.join(" ")}`,
].join("\n"));

process.exit(isPostinstall ? 0 : installResult.status ?? 1);