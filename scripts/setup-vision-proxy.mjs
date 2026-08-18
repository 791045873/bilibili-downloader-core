import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const pythonDir = join(repoRoot, "packages", "vision-proxy");
const pyprojectPath = join(pythonDir, "pyproject.toml");
const venvDir = join(pythonDir, ".venv");
const venvPython = process.platform === "win32"
  ? join(venvDir, "Scripts", "python.exe")
  : join(venvDir, "bin", "python");
const venvPythonCmd = process.platform === "win32" ? `"${venvPython}"` : venvPython;
const isPostinstall = process.argv.includes("--postinstall");

if (!existsSync(pyprojectPath)) {
  console.warn(`未找到 vision proxy 的 pyproject 文件: ${pyprojectPath}`);
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

if (!existsSync(venvPython)) {
  const createResult = spawnSync(python.command, [...python.args, "-m", "venv", venvDir], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (createResult.status !== 0) {
    console.warn("vision proxy 虚拟环境创建失败，已跳过依赖安装。");
    process.exit(isPostinstall ? 0 : createResult.status ?? 1);
  }
}

const pyprojectContent = readFileSync(pyprojectPath, "utf8");
const depsBlock = pyprojectContent.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
const moduleNames = [...depsBlock.matchAll(/"([a-zA-Z0-9_.-]+)/g)]
  .map((match) => match[1])
  .map((name) => (name === "python-dotenv" ? "dotenv" : name))
  .filter(Boolean);

if (moduleNames.length > 0) {
  const checkCode = `import ${moduleNames.join(", ")}`;
  const checkArgs = process.platform === "win32"
    ? [`-c "${checkCode}"`]
    : ["-c", checkCode];

  const checkResult = spawnSync(venvPythonCmd, checkArgs, {
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  if (checkResult.status === 0) {
    if (!isPostinstall) {
      console.log("vision proxy Python 依赖已就绪，无需重新安装。");
    }
    process.exit(0);
  }
}

const installArgs = ["-m", "pip", "install", "."];

console.log(
  isPostinstall
    ? `正在为 vision proxy 安装 Python 依赖: ${venvPython} ${installArgs.join(" ")} (in ${pythonDir})`
    : `开始安装 vision proxy Python 依赖: ${venvPython} ${installArgs.join(" ")} (in ${pythonDir})`,
);

const installResult = spawnSync(venvPythonCmd, installArgs, {
  cwd: pythonDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (installResult.status === 0) {
  console.log("vision proxy Python 依赖已就绪。");
  process.exit(0);
}

console.warn([
  "vision proxy Python 依赖安装失败。",
  `请检查 pip / 网络环境后重试: ${venvPython} ${installArgs.join(" ")} (in ${pythonDir})`,
].join("\n"));

process.exit(isPostinstall ? 0 : installResult.status ?? 1);
