# ---- Stage 1: Build ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# 复制依赖清单
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/adapters/package.json packages/adapters/tsconfig.json packages/adapters/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/frontend/package.json packages/frontend/tsconfig.json packages/frontend/vite.config.ts packages/frontend/

# 复制源码
COPY packages/core/ packages/core/
COPY packages/adapters/ packages/adapters/
COPY packages/server/ packages/server/
COPY packages/frontend/ packages/frontend/

RUN pnpm approve-builds --all
RUN pnpm install --frozen-lockfile

# 按依赖顺序构建
RUN pnpm --filter @bilibili-downloader/core build
RUN pnpm --filter @bilibili-downloader/adapters build
RUN pnpm --filter @bilibili-downloader/server build
RUN pnpm --filter @bilibili-downloader/frontend build

# ---- Stage 2: Runtime ----
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app

# 直接复用构建阶段的 packages 目录（含所有 dist 产物）和 node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# 前端静态文件 — server 里用 process.cwd()/public
COPY --from=builder /app/packages/frontend/dist ./public

EXPOSE 3000
ENV PORT=3000
ENV OUTPUT_DIR=/downloads
ENV MAX_CONCURRENT_DOWNLOADS=10
RUN mkdir -p /downloads

CMD ["node", "packages/server/dist/main.js"]