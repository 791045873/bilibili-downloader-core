# Bilibili 下载器 Docker 镜像
# 用法:
#   docker build -t bilibili-downloader .
#   docker run -p 3000:3000 -v ./downloads:/downloads bilibili-downloader

FROM node:22-alpine

# 安装 ffmpeg
RUN apk add --no-cache ffmpeg

# 设置工作目录
WORKDIR /app

# 复制打包好的 Web 服务器
COPY packages/cli/bin/server.cjs ./server.cjs

# 暴露端口
EXPOSE 3000

# 环境变量
ENV PORT=3000
ENV OUTPUT_DIR=/downloads

# 创建下载目录
RUN mkdir -p /downloads

# 启动
CMD ["node", "server.cjs"]