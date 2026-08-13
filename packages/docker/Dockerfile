# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine

# ---- Stage 1: Build ----
FROM ${NODE_IMAGE} AS builder

RUN apk add --no-cache python3 make g++
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages/bilibili-api-sdk/package.json packages/bilibili-api-sdk/tsconfig.json packages/bilibili-api-sdk/
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/adapters/package.json packages/adapters/tsconfig.json packages/adapters/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/frontend/package.json packages/frontend/tsconfig.json packages/frontend/vite.config.ts packages/frontend/
COPY packages/docker/package.json packages/docker/
COPY scripts/check-ffmpeg.mjs scripts/setup-vision-proxy.mjs scripts/

RUN --mount=type=cache,id=bilibili-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts

COPY packages/bilibili-api-sdk/ packages/bilibili-api-sdk/
COPY packages/core/ packages/core/
COPY packages/adapters/ packages/adapters/
COPY packages/server/ packages/server/
COPY packages/frontend/ packages/frontend/

RUN --mount=type=cache,id=bilibili-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --ignore-scripts
RUN pnpm rebuild better-sqlite3 esbuild

RUN pnpm --filter bilibili-api-sdk build
RUN pnpm --filter @bilibili-downloader/core build
RUN pnpm --filter @bilibili-downloader/adapters build
RUN pnpm --filter @bilibili-downloader/server build
RUN pnpm --filter @bilibili-downloader/frontend build
RUN --mount=type=cache,id=bilibili-pnpm-store,target=/pnpm/store \
    pnpm --filter @bilibili-downloader/server deploy --prod --legacy --ignore-scripts /app/runtime
RUN --mount=type=cache,id=bilibili-node-gyp,target=/root/.cache/node-gyp \
    npm_config_build_from_source=true npm --prefix /app/runtime/node_modules/better-sqlite3 run install

# ---- Stage 2: Runtime ----
FROM ${NODE_IMAGE} AS runtime

RUN apk add --no-cache ffmpeg python3 py3-pip
WORKDIR /app

COPY --from=builder /app/runtime ./

COPY packages/server/python/pyproject.toml /tmp/vision-proxy/pyproject.toml
RUN --mount=type=cache,id=bilibili-pip-cache,target=/root/.cache/pip \
    python3 -m pip install --break-system-packages --no-compile /tmp/vision-proxy
COPY packages/server/python/qwen_vision_proxy.py /app/python/qwen_vision_proxy.py

COPY --from=builder /app/packages/frontend/dist ./public
COPY packages/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /download /download/logs

EXPOSE 3000
ENV PORT=3000 \
    OUTPUT_DIR=/download \
    LOG_DIR=/download/logs \
    MAX_CONCURRENT_DOWNLOADS=10 \
    QWEN_VISION_PROXY_URL=http://127.0.0.1:8765/v1/chat/completions \
    QWEN_VISION_PROXY_HOST=127.0.0.1 \
    QWEN_VISION_PROXY_PORT=8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "Promise.all([fetch('http://127.0.0.1:' + process.env.PORT), fetch('http://127.0.0.1:8765/healthz')]).then(([app, proxy]) => process.exit(app.ok && proxy.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["/app/entrypoint.sh"]
