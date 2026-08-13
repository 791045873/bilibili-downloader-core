# syntax=docker/dockerfile:1.7

ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# ---- Stage 1: Build Node and frontend ----
FROM node:24.16.0-bookworm-slim AS builder

ARG APT_MIRROR
ARG NPM_REGISTRY

RUN --mount=type=cache,id=bilibili-apt-archives,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=bilibili-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    if [ -n "$APT_MIRROR" ]; then \
      case "$APT_MIRROR" in http://*|https://*) ;; *) exit 1 ;; esac; \
      mirror_host="${APT_MIRROR#http://}"; \
      mirror_host="${mirror_host#https://}"; \
      case "$mirror_host" in ""|*/*|*@*|*[[:space:]]*) exit 1 ;; esac; \
      sed -i \
        -e "s#http://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#http://security.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://security.debian.org#${APT_MIRROR%/}#g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates python3 make g++

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
    set -eux; \
    pnpm config set store-dir /pnpm/store; \
    if [ -n "$NPM_REGISTRY" ]; then pnpm config set registry "$NPM_REGISTRY"; fi; \
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
    npm --prefix /app/runtime/node_modules/better-sqlite3 run install
RUN cd /app/runtime && node --input-type=module -e \
    "import Database from 'better-sqlite3'; const db = new Database(':memory:'); db.exec('create table smoke (id integer)'); db.prepare('insert into smoke values (?)').run(1); if (db.prepare('select id from smoke').get().id !== 1) process.exit(1); db.close()"

# ---- Stage 2: Build Python virtual environment ----
FROM node:24.16.0-bookworm-slim AS python-builder

ARG APT_MIRROR
ARG PIP_INDEX_URL

RUN --mount=type=cache,id=bilibili-apt-archives,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=bilibili-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    if [ -n "$APT_MIRROR" ]; then \
      case "$APT_MIRROR" in http://*|https://*) ;; *) exit 1 ;; esac; \
      mirror_host="${APT_MIRROR#http://}"; \
      mirror_host="${mirror_host#https://}"; \
      case "$mirror_host" in ""|*/*|*@*|*[[:space:]]*) exit 1 ;; esac; \
      sed -i \
        -e "s#http://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#http://security.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://security.debian.org#${APT_MIRROR%/}#g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates python3 python3-venv

COPY packages/server/python/pyproject.toml /tmp/vision-proxy/pyproject.toml
RUN python3 -m venv --copies /opt/vision-venv
RUN --mount=type=cache,id=bilibili-pip-cache,target=/root/.cache/pip \
    set -eux; \
    if [ -n "$PIP_INDEX_URL" ]; then \
      /opt/vision-venv/bin/python -m pip install --index-url "$PIP_INDEX_URL" /tmp/vision-proxy; \
    else \
      /opt/vision-venv/bin/python -m pip install /tmp/vision-proxy; \
    fi; \
    /opt/vision-venv/bin/python -c "import dashscope, dotenv"; \
    /opt/vision-venv/bin/python -m pip uninstall -y pip setuptools wheel; \
    rm -f /opt/vision-venv/bin/pip /opt/vision-venv/bin/pip3 /opt/vision-venv/bin/pip3.*

# ---- Stage 3: Runtime ----
FROM node:24.16.0-bookworm-slim AS runtime

ARG APT_MIRROR

RUN --mount=type=cache,id=bilibili-apt-archives,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=bilibili-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    if [ -n "$APT_MIRROR" ]; then \
      case "$APT_MIRROR" in http://*|https://*) ;; *) exit 1 ;; esac; \
      mirror_host="${APT_MIRROR#http://}"; \
      mirror_host="${mirror_host#https://}"; \
      case "$mirror_host" in ""|*/*|*@*|*[[:space:]]*) exit 1 ;; esac; \
      sed -i \
        -e "s#http://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://deb.debian.org#${APT_MIRROR%/}#g" \
        -e "s#http://security.debian.org#${APT_MIRROR%/}#g" \
        -e "s#https://security.debian.org#${APT_MIRROR%/}#g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 tini; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/runtime ./
COPY --from=python-builder /opt/vision-venv /opt/vision-venv
COPY packages/server/python/qwen_vision_proxy.py /app/python/qwen_vision_proxy.py
COPY --from=builder /app/packages/frontend/dist ./public
COPY packages/docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && \
    mkdir -p /download /download/logs && \
    /opt/vision-venv/bin/python -c "import dashscope, dotenv" && \
    cd /app && node --input-type=module -e \
      "import Database from 'better-sqlite3'; const db = new Database(':memory:'); db.exec('select 1'); db.close()"

EXPOSE 3000
ENV PATH=/opt/vision-venv/bin:$PATH \
    PORT=3000 \
    OUTPUT_DIR=/download \
    LOG_DIR=/download/logs \
    MAX_CONCURRENT_DOWNLOADS=10 \
    QWEN_VISION_PROXY_URL=http://127.0.0.1:8765/v1/chat/completions \
    QWEN_VISION_PROXY_HOST=127.0.0.1 \
    QWEN_VISION_PROXY_PORT=8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "Promise.all([fetch('http://127.0.0.1:' + process.env.PORT), fetch('http://127.0.0.1:8765/healthz')]).then(([app, proxy]) => process.exit(app.ok && proxy.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
