// 镜像版本解析与 docker 命令派发：镜像 tag = 对应包 version，每次构建显式指定。
// SERVER_VERSION / VISION_PROXY_VERSION 环境变量可覆盖包版本（如发测试 tag）。
// 版本同步写入本目录 .env（保留用户其他配置行），使直接 docker compose 命令也可用。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dockerDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dockerDir, "../..");

function readServerVersion() {
  const pkg = JSON.parse(
    readFileSync(join(root, "packages/server/package.json"), "utf8"),
  );
  return pkg.version;
}

function readVisionProxyVersion() {
  const pyproject = readFileSync(
    join(root, "packages/vision-proxy/pyproject.toml"),
    "utf8",
  );
  const m = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
  if (!m)
    throw new Error("packages/vision-proxy/pyproject.toml 缺少 version 字段");
  return m[1];
}

const versions = {
  SERVER_VERSION: process.env.SERVER_VERSION ?? readServerVersion(),
  VISION_PROXY_VERSION:
    process.env.VISION_PROXY_VERSION ?? readVisionProxyVersion(),
};

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const [name, value] of Object.entries(versions)) {
  if (!TAG_RE.test(value)) {
    console.error(
      `[compose.mjs] ${name}=${JSON.stringify(value)} 不是合法 docker tag`,
    );
    process.exit(1);
  }
}

// 合并写 .env：仅更新/追加版本两键，保留用户自定义行
const envPath = join(dockerDir, ".env");
const existing = (() => {
  try {
    return readFileSync(envPath, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
})();
const seen = new Set();
const lines = existing.map((line) => {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (m && versions[m[1]] !== undefined) {
    seen.add(m[1]);
    return `${m[1]}=${versions[m[1]]}`;
  }
  return line;
});
for (const [name, value] of Object.entries(versions)) {
  if (!seen.has(name)) lines.push(`${name}=${value}`);
}
while (lines.length && lines[lines.length - 1] === "") lines.pop();
writeFileSync(envPath, lines.join("\n") + "\n");

console.log(
  `[compose.mjs] server=${versions.SERVER_VERSION} vision-proxy=${versions.VISION_PROXY_VERSION}`,
);

const env = { ...process.env, ...versions };
const [cmd, ...args] = process.argv.slice(2);

function run(argv) {
  const r = spawnSync("docker", argv, {
    cwd: dockerDir,
    env,
    stdio: "inherit",
  });
  if (r.error) {
    console.error(`[compose.mjs] 无法执行 docker：${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (cmd === "build-server" || cmd === "build-vision-proxy") {
  const target = cmd.replace("build-", "");
  run([
    "build",
    "-f",
    `Dockerfile.${target}`,
    "-t",
    `bilibili-downloader-${target}:${versions[target === "server" ? "SERVER_VERSION" : "VISION_PROXY_VERSION"]}`,
    "../..",
  ]);
} else if (
  cmd === "save" ||
  cmd === "save-server" ||
  cmd === "save-vision-proxy"
) {
  const images =
    cmd === "save"
      ? [
          `bilibili-downloader-server:${versions.SERVER_VERSION}`,
          `bilibili-downloader-vision-proxy:${versions.VISION_PROXY_VERSION}`,
        ]
      : [
          `bilibili-downloader-${cmd.replace("save-", "")}:${versions[cmd === "save-server" ? "SERVER_VERSION" : "VISION_PROXY_VERSION"]}`,
        ];
  const outDir =
    cmd === "save" ? join(root, "dist") : join(root, "dist", "docker");
  const outFile =
    cmd === "save"
      ? "bilibili-downloader-images.tar"
      : `${cmd.replace("save-", "bilibili-downloader-")}_linux-amd64.tar`;
  mkdirSync(outDir, { recursive: true });
  run(["save", "-o", join(outDir, outFile), ...images]);
} else if (cmd === undefined) {
  console.error(
    "用法: node compose.mjs <docker compose 参数...> | build-server | build-vision-proxy | save | save-server | save-vision-proxy",
  );
  process.exit(1);
} else {
  run(["compose", ...process.argv.slice(2)]);
}
