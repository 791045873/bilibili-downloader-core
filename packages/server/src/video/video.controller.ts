import { Controller, Get, Post, Query, Body, Res } from "@nestjs/common";
import type { Response } from "express";
import { DownloadService } from "../download/download.service.js";

@Controller("api/video")
export class VideoController {
  constructor(private readonly service: DownloadService) {}

  /**
   * 获取视频元信息 + 分P列表 + 合集信息
    * @deprecated 请使用 POST /api/parse-link 作为统一链接识别入口
   */
  @Get("/info")
  async getVideoInfo(@Query("input") input: string) {
    if (!input) return { error: "缺少 input 参数" };
    return this.service.getVideoInfo(input);
  }

  /**
   * 代理 B站封面图片（绕过防盗链 Referer 检查）
   */
  @Get("/cover")
  async getCover(@Query("url") url: string, @Res() res: Response) {
    if (!url) {
      res.status(400).json({ error: "缺少 url 参数" });
      return;
    }
    try {
      const { data, contentType } = await this.service.proxyCoverImage(url);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(data);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  }

  /** 解析单个视频流 */
  @Post("/parse")
  async parseVideo(@Body() body: { bvid: string; cid: number }) {
    if (!body.bvid || !body.cid) {
      return { error: "缺少 bvid 或 cid 参数" };
    }
    return this.service.parseVideo(body.bvid, body.cid);
  }

  /** 批量解析视频流 */
  @Post("/parse-all")
  async parseAllVideos(
    @Body() body: { bvid: string; cids: number[] },
  ) {
    if (!body.bvid || !body.cids?.length) {
      return { error: "缺少 bvid 或 cids 参数" };
    }
    return this.service.parseAllVideos(body.bvid, body.cids);
  }
}