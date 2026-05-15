# Bilibili 下载器 Docker 镜像
# 用法:
#   cd packages/server && node build-server.mjs
#   docker build -t bilibili-downloader .
#   docker run -d -p 3000:3000 -v ./downloads:/downloads bilibili-downloader

FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY packages/server/bin/server.cjs ./server.cjs

EXPOSE 3000

ENV PORT=3000
ENV OUTPUT_DIR=/downloads

RUN mkdir -p /downloads

CMD ["node", "server.cjs"]