/**
 * AI 总结提示词服务
 *
 * 业务规则：
 * - 系统内置提示词（is_system=1）不可编辑、不可删除。
 * - 系统默认（is_default=1）至多一条；删除默认（非内置）后默认自动回落内置提示词。
 * - 创作者绑定按 mid 唯一，后写覆盖先写。
 */

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DatabaseService,
  type AiPromptRecord,
} from "../database/database.service.js";
import { AI_PROMPT_FORMAT_SNIPPET } from "./prompt-template.js";

@Injectable()
export class PromptService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<AiPromptRecord[]> {
    return this.db.listAiPrompts();
  }

  async get(id: number): Promise<AiPromptRecord | undefined> {
    return this.db.getAiPromptById(id);
  }

  async create(input: {
    name: string;
    content: string;
  }): Promise<AiPromptRecord> {
    return this.db.insertAiPrompt({
      name: input.name,
      content: input.content,
      isSystem: 0,
      isDefault: 0,
    });
  }

  async update(
    id: number,
    input: { name?: string; content?: string },
  ): Promise<AiPromptRecord> {
    await this.assertNotSystem(id, "系统内置提示词不可编辑");
    const updated = await this.db.updateAiPrompt(id, {
      name: input.name !== undefined ? input.name.trim() : undefined,
      content: input.content,
    });
    if (!updated) {
      throw new NotFoundException("提示词不存在");
    }
    return updated;
  }

  async remove(id: number): Promise<void> {
    await this.assertNotSystem(id, "系统内置提示词不可删除");
    const removed = await this.db.getAiPromptById(id);
    if (!removed) {
      throw new NotFoundException("提示词不存在");
    }
    const wasDefault = removed.isDefault === 1;
    await this.db.deleteAiPrompt(id);
    if (wasDefault) {
      await this.fallbackDefaultToBuiltin();
    }
  }

  async setDefault(id: number): Promise<void> {
    const prompt = await this.db.getAiPromptById(id);
    if (!prompt) {
      throw new NotFoundException("提示词不存在");
    }
    await this.db.clearAiPromptDefault();
    await this.db.setAiPromptDefault(id);
  }

  getFormatSnippet(): string {
    return AI_PROMPT_FORMAT_SNIPPET;
  }

  async getDefaultPromptId(): Promise<number | undefined> {
    return this.db.getDefaultAiPromptId();
  }

  async getCreatorBinding(
    mid: number,
  ): Promise<{ mid: number; promptId: number } | undefined> {
    return this.db.getCreatorBindingByMid(mid);
  }

  async setCreatorBinding(mid: number, promptId: number): Promise<void> {
    if (!(await this.db.getAiPromptById(promptId))) {
      throw new NotFoundException("提示词不存在");
    }
    await this.db.upsertCreatorBinding(mid, promptId);
  }

  async deleteCreatorBinding(mid: number): Promise<void> {
    await this.db.deleteCreatorBinding(mid);
  }

  /**
   * /analysis/run 的提示词解析：显式 promptId → 系统默认 → undefined（引擎回退内置）。
   * 引用的提示词已被删除时跳过向下。
   */
  async resolveForRun(promptId?: number): Promise<{
    promptId?: number;
    content?: string;
  }> {
    if (promptId !== undefined) {
      const explicitPrompt = await this.db.getAiPromptById(promptId);
      if (explicitPrompt) {
        return { promptId, content: explicitPrompt.content };
      }
    }
    const defaultId = await this.db.getDefaultAiPromptId();
    if (defaultId !== undefined) {
      const defaultPrompt = await this.db.getAiPromptById(defaultId);
      if (defaultPrompt) {
        return { promptId: defaultId, content: defaultPrompt.content };
      }
    }
    return {};
  }

  private async assertNotSystem(
    id: number,
    conflictMessage: string,
  ): Promise<void> {
    const prompt = await this.db.getAiPromptById(id);
    if (!prompt) {
      throw new NotFoundException("提示词不存在");
    }
    if (prompt.isSystem === 1) {
      throw new ConflictException(conflictMessage);
    }
  }

  private async fallbackDefaultToBuiltin(): Promise<void> {
    const builtin = (await this.db.listAiPrompts()).find(
      (p) => p.isSystem === 1,
    );
    if (builtin?.id !== undefined) {
      await this.db.clearAiPromptDefault();
      await this.db.setAiPromptDefault(builtin.id);
    }
  }
}
