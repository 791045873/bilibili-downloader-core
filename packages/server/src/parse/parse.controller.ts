import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from "@nestjs/common";
import { ParseService } from "./parse.service.js";

interface ParseLinkRequest {
  input: string;
}

@Controller("api")
export class ParseController {
  constructor(private readonly parseService: ParseService) {}

  @Post("/parse-link")
  async parseLink(@Body() body: ParseLinkRequest) {
    if (!body?.input || !body.input.trim()) {
      throw new BadRequestException("input 不能为空");
    }

    try {
      return await this.parseService.parseLink(body.input);
    } catch (err) {
      return this.parseService.mapApiError(err);
    }
  }

  @Get("/user-space/videos")
  async getUserSpaceVideos(
    @Query("mid") mid: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const parsed = parsePagination(page, pageSize);
    const midNum = toPositiveInt(mid, "mid");

    try {
      return await this.parseService.getUserSpaceVideos(
        midNum,
        parsed.page,
        parsed.pageSize,
      );
    } catch (err) {
      return this.parseService.mapApiError(err);
    }
  }

  @Get("/ugc-season/videos")
  async getUgcSeasonVideos(
    @Query("seasonId") seasonId: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const parsed = parsePagination(page, pageSize);
    const seasonIdNum = toPositiveInt(seasonId, "seasonId");

    try {
      return await this.parseService.getUgcSeasonVideos(
        seasonIdNum,
        parsed.page,
        parsed.pageSize,
      );
    } catch (err) {
      return this.parseService.mapApiError(err);
    }
  }

  @Get("/favorites/videos")
  async getFavoritesVideos(
    @Query("mediaId") mediaId: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const parsed = parsePagination(page, pageSize);
    const mediaIdNum = toPositiveInt(mediaId, "mediaId");

    try {
      return await this.parseService.getFavoritesVideos(
        mediaIdNum,
        parsed.page,
        parsed.pageSize,
      );
    } catch (err) {
      return this.parseService.mapApiError(err);
    }
  }
}

function toPositiveInt(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${name} 必须为正整数`);
  }
  return n;
}

function parsePagination(pageRaw: string, pageSizeRaw: string): { page: number; pageSize: number } {
  const page = toPositiveInt(pageRaw, "page");
  const pageSize = toPositiveInt(pageSizeRaw, "pageSize");
  return { page, pageSize };
}
