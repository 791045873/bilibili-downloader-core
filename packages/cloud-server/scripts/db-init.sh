#!/usr/bin/env sh
# 数据库 schema 演进：读取 packages/server/.env 的 DATABASE_URL 后
# 执行 prisma db init（对已签名旧库只补 additive 差异，幂等），随后 db verify 校验。
cd "$(dirname "$0")/.." || exit 1

if [ ! -f .env ]; then
  echo "未找到 packages/server/.env，请先配置 DATABASE_URL" >&2
  exit 1
fi
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -n 1 | cut -d= -f2-)"
if [ -z "$DATABASE_URL" ]; then
  echo "packages/server/.env 中未找到 DATABASE_URL" >&2
  exit 1
fi
export DATABASE_URL

pnpm exec prisma db init || exit $?
pnpm exec prisma db verify
