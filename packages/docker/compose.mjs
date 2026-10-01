// 镜像版本解析与 docker 命令派发：镜像 tag = 对应包 package.json 的 version
// （cloud-server / nas-worker / vision-proxy 各取自身包），每次构建显式指定。
// CLOUD_SERVER_VERSION / NAS_WORKER_VERSION / VISION_PROXY_VERSION 环境变量可覆盖包版本（如发测试 tag）。
// 版本同步写入本目录 .env（保留用户其他配置行），使直接 docker compose 命令也可用。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dockerDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dockerDir, "../..");

function readPkgVersion(pkgPath) {
  const pkg = JSON.parse(readFileSync(join(root, pkgPath), "utf8"));
  if (!pkg.version) throw new Error(`${pkgPath} 缺少 version 字段`);
  return pkg.version;
}

const versions = {
  CLOUD_SERVER_VERSION:
    process.env.CLOUD_SERVER_VERSION ??
    readPkgVersion("packages/cloud-server/package.json"),
  NAS_WORKER_VERSION:
    process.env.NAS_WORKER_VERSION ??
    readPkgVersion("packages/nas-worker/package.json"),
  VISION_PROXY_VERSION:
    process.env.VISION_PROXY_VERSION ??
    readPkgVersion("packages/vision-proxy/package.json"),
};

// 统一仓库命名：<目标>-<版本> 作 tag
const images = {
  "cloud-server": `bilibili-downloader:cloud-server-${versions.CLOUD_SERVER_VERSION}`,
  "nas-worker": `bilibili-downloader:nas-worker-${versions.NAS_WORKER_VERSION}`,
  "vision-proxy": `bilibili-downloader:vision-proxy-${versions.VISION_PROXY_VERSION}`,
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

// 合并写 .env：仅更新/追加三版本键，保留用户自定义行
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
  `[compose.mjs] cloud-server=${versions.CLOUD_SERVER_VERSION} nas-worker=${versions.NAS_WORKER_VERSION} vision-proxy=${versions.VISION_PROXY_VERSION}`,
);

const env = { ...process.env, ...versions };
const [cmd] = process.argv.slice(2);

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

const BUILD_TARGETS = new Set(["cloud-server", "nas-worker", "vision-proxy"]);

if (cmd && cmd.startsWith("build-")) {
  const target = cmd.replace("build-", "");
  if (!BUILD_TARGETS.has(target)) {
    console.error(`[compose.mjs] 未知构建目标：${target}`);
    process.exit(1);
  }
  run([
    "build",
    // 镜像面向 amd64 部署，跨架构机器（如 Apple Silicon）构建时固定平台
    "--platform",
    "linux/amd64",
    "-f",
    `Dockerfile.${target}`,
    "-t",
    images[target],
    "../..",
  ]);
} else if (cmd === "save" || (cmd && cmd.startsWith("save-"))) {
  const target = cmd === "save" ? null : cmd.replace("save-", "");
  if (target && !BUILD_TARGETS.has(target)) {
    console.error(`[compose.mjs] 未知保存目标：${target}`);
    process.exit(1);
  }
  const imageList = target ? [images[target]] : Object.values(images);
  const outDir = target ? join(root, "dist", "docker") : join(root, "dist");
  const outFile = target
    ? `bilibili-downloader-${target}_linux-amd64.tar`
    : "bilibili-downloader-images.tar";
  mkdirSync(outDir, { recursive: true });
  run(["save", "-o", join(outDir, outFile), ...imageList]);
} else if (cmd === undefined) {
  console.error(
    "用法: node compose.mjs <docker compose 参数...> | build-cloud-server | build-nas-worker | build-vision-proxy | save | save-cloud-server | save-nas-worker | save-vision-proxy",
  );
  process.exit(1);
} else {
  run(["compose", ...process.argv.slice(2)]);
}
