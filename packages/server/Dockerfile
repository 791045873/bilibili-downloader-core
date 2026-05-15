# Bilibili 下载器 Docker 镜像
# 用法:
#   pnpm build:bundle
#   pnpm docker:build
#   pnpm docker:run

FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY bin/server.cjs ./server.cjs
COPY src/index.html ./index.html

EXPOSE 3000

ENV PORT=3000
ENV OUTPUT_DIR=/downloads

RUN mkdir -p /downloads

CMD ["node", "server.cjs"]