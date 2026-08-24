/**
 * AI 总结提示词管理 API
 *
 * 路由全部挂在 /api/analysis/prompts 下。
 * 注意：/format-snippet 与 /creator 字面路由声明在 /:id 参数路由之前，
 * 避免 "creator"/"format-snippet" 被 :id 捕获。
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { PromptService } from "./prompt.service.js";
import { createLogMessage } from "../logging/server-log.util.js";

@Controller("api/analysis/prompts")
export class PromptController {
  private readonly logger = new Logger(PromptController.name);

  constructor(private readonly promptService: PromptService) {}

  @Get("/format-snippet")
  getFormatSnippet(): { snippet: string } {
    return { snippet: this.promptService.getFormatSnippet() };
  }

  @Get("/creator")
  async getCreatorBinding(@Query("mid") mid: string) {
    const midNum = toPositiveInt(mid, "mid");
    const binding = await this.promptService.getCreatorBinding(midNum);
    if (!binding) {
      return null;
    }
    return binding;
  }

  @Put("/creator")
  async setCreatorBinding(
    @Body() body: { mid?: number; promptId?: number },
  ): Promise<{ message: string }> {
    const mid = toPositiveInt(body?.mid, "mid");
    const promptId = toPositiveInt(body?.promptId, "promptId");
    await this.promptService.setCreatorBinding(mid, promptId);
    return { message: "已绑定" };
  }

  @Delete("/creator")
  async deleteCreatorBinding(
    @Query("mid") mid: string,
  ): Promise<{ message: string }> {
    const midNum = toPositiveInt(mid, "mid");
    await this.promptService.deleteCreatorBinding(midNum);
    return { message: "已解除绑定" };
  }

  @Get()
  async list(): Promise<{ items: Awaited<ReturnType<PromptService["list"]>> }> {
    return { items: await this.promptService.list() };
  }

  @Post()
  async create(
    @Body() body: { name?: unknown; content?: unknown },
  ): Promise<Awaited<ReturnType<PromptService["create"]>>> {
    if (
      typeof body?.name !== "string" ||
      body.name.trim().length === 0 ||
      typeof body?.content !== "string" ||
      body.content.trim().length === 0
    ) {
      throw new BadRequestException("name/content 必填且不能为空");
    }
    this.logger.log(
      createLogMessage("Create AI summary prompt requested", {
        promptName: body.name.trim(),
      }),
    );
    return this.promptService.create({
      name: body.name.trim(),
      content: body.content,
    });
  }

  @Put("/:id/default")
  async setDefault(
    @Param("id") id: string,
  ): Promise<Awaited<ReturnType<PromptService["get"]>>> {
    const promptId = toPositiveInt(id, "id");
    await this.promptService.setDefault(promptId);
    return this.promptService.get(promptId);
  }

  @Put("/:id")
  async update(
    @Param("id") id: string,
    @Body() body: { name?: unknown; content?: unknown },
  ): Promise<Awaited<ReturnType<PromptService["update"]>>> {
    const promptId = toPositiveInt(id, "id");
    const patch: { name?: string; content?: string } = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        throw new BadRequestException("name 不能为空");
      }
      patch.name = body.name;
    }
    if (body?.content !== undefined) {
      if (typeof body.content !== "string" || body.content.trim().length === 0) {
        throw new BadRequestException("content 不能为空");
      }
      patch.content = body.content;
    }
    return this.promptService.update(promptId, patch);
  }

  @Delete("/:id")
  async remove(@Param("id") id: string): Promise<{ message: string }> {
    const promptId = toPositiveInt(id, "id");
    await this.promptService.remove(promptId);
    return { message: "已删除" };
  }
}

function parsePositiveIntValue(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequestException(`${name} 必须为正整数`);
  }
  return n;
}

function toPositiveInt(value: unknown, name: string): number {
  const n = parsePositiveIntValue(value, name);
  if (n === undefined) {
    throw new BadRequestException(`${name} 必填且必须为正整数`);
  }
  return n;
}