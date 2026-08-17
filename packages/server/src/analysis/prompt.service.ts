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

  list(): AiPromptRecord[] {
    return this.db.listAiPrompts();
  }

  get(id: number): AiPromptRecord | undefined {
    return this.db.getAiPromptById(id);
  }

  create(input: { name: string; content: string }): AiPromptRecord {
    return this.db.insertAiPrompt({
      name: input.name,
      content: input.content,
      isSystem: 0,
      isDefault: 0,
    });
  }

  update(
    id: number,
    input: { name?: string; content?: string },
  ): AiPromptRecord {
    this.assertNotSystem(id, "系统内置提示词不可编辑");
    const updated = this.db.updateAiPrompt(id, {
      name: input.name !== undefined ? input.name.trim() : undefined,
      content: input.content,
    });
    if (!updated) {
      throw new NotFoundException("提示词不存在");
    }
    return updated;
  }

  remove(id: number): void {
    this.assertNotSystem(id, "系统内置提示词不可删除");
    const removed = this.db.getAiPromptById(id);
    if (!removed) {
      throw new NotFoundException("提示词不存在");
    }
    const wasDefault = removed.isDefault === 1;
    this.db.deleteAiPrompt(id);
    if (wasDefault) {
      this.fallbackDefaultToBuiltin();
    }
  }

  setDefault(id: number): void {
    const prompt = this.db.getAiPromptById(id);
    if (!prompt) {
      throw new NotFoundException("提示词不存在");
    }
    this.db.clearAiPromptDefault();
    this.db.setAiPromptDefault(id);
  }

  getFormatSnippet(): string {
    return AI_PROMPT_FORMAT_SNIPPET;
  }

  getDefaultPromptId(): number | undefined {
    return this.db.getDefaultAiPromptId();
  }

  getCreatorBinding(mid: number): { mid: number; promptId: number } | undefined {
    return this.db.getCreatorBindingByMid(mid);
  }

  setCreatorBinding(mid: number, promptId: number): void {
    if (!this.db.getAiPromptById(promptId)) {
      throw new NotFoundException("提示词不存在");
    }
    this.db.upsertCreatorBinding(mid, promptId);
  }

  deleteCreatorBinding(mid: number): void {
    this.db.deleteCreatorBinding(mid);
  }

  /**
   * /analysis/run 的提示词解析：显式 promptId → 系统默认 → undefined（引擎回退内置）。
   * 引用的提示词已被删除时跳过向下。
   */
  resolveForRun(promptId?: number): { promptId?: number; content?: string } {
    if (promptId !== undefined) {
      const explicitPrompt = this.db.getAiPromptById(promptId);
      if (explicitPrompt) {
        return { promptId, content: explicitPrompt.content };
      }
    }
    const defaultId = this.db.getDefaultAiPromptId();
    if (defaultId !== undefined) {
      const defaultPrompt = this.db.getAiPromptById(defaultId);
      if (defaultPrompt) {
        return { promptId: defaultId, content: defaultPrompt.content };
      }
    }
    return {};
  }

  private assertNotSystem(id: number, conflictMessage: string): void {
    const prompt = this.db.getAiPromptById(id);
    if (!prompt) {
      throw new NotFoundException("提示词不存在");
    }
    if (prompt.isSystem === 1) {
      throw new ConflictException(conflictMessage);
    }
  }

  private fallbackDefaultToBuiltin(): void {
    const builtin = this.db.listAiPrompts().find((p) => p.isSystem === 1);
    if (builtin?.id !== undefined) {
      this.db.clearAiPromptDefault();
      this.db.setAiPromptDefault(builtin.id);
    }
  }
}