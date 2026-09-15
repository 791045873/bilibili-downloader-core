/**
 * 问答编排：每轮 = query 重写 → 照片分析 → 向量检索 → 多模态生成 → 三段式拼装 → 持久化。
 * 模型恒为当前用户配置（app_settings 的 llm.modelName / llm.apiKey，经 vision proxy 调用）。
 */

import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { QwenClient, type LlmConfig, type MultimodalContent } from "@bilibili-downloader/adapters";
import { DatabaseService } from "../database/database.service.js";
import {
  EmbeddingApiError,
  EmbeddingConfigError,
  EmbeddingService,
  normalizeEmbeddingText,
} from "../knowledge/embedding.service.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { parseCitationNumbers } from "./citation.js";
import { CHAT_FALLBACK_TEXT, getChatConfig } from "./chat-config.js";
import {
  CHAT_SYSTEM_PROMPT,
  PHOTO_ANALYSIS_PROMPT,
  buildAnswerUserPrompt,
  buildHistoryText,
  buildRewritePrompt,
  buildTipsText,
} from "./chat-prompt.js";
import type { ChatHit, ChatReplyPayload } from "./chat.types.js";

const MAX_VISUAL_IMAGES = 6;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly embedding: EmbeddingService,
  ) {}

  async handleUserMessage(
    conversationId: number,
    content: string,
    photoUrls: string[],
  ): Promise<{ userMessageId: number; assistantMessageId: number | null; reply: ChatReplyPayload }> {
    const config = getChatConfig();
    // 配置预检在落库前：缺配置时 503 且不落任何消息
    const qwen = await this.createQwenClient();
    const history = await this.db.listMessages(conversationId);
    const userMessageId = await this.db.insertMessage({
      conversationId,
      role: "user",
      content,
      photoUrls,
    });
    if (history.length === 0) {
      const titleSource = content !== "" ? content : "照片问答";
      await this.db.updateConversationTitleAndTouch(
        conversationId,
        titleSource.length > 30 ? `${titleSource.slice(0, 30)}…` : titleSource,
      );
    } else {
      await this.db.updateConversationTitleAndTouch(conversationId);
    }

    // 1. query 重写（有历史且本轮有文字时）
    let question = content;
    const historyText = buildHistoryText(
      history.map((m) => ({ role: m.role, content: m.content })),
      config.historyRounds,
    );
    if (history.length > 0 && content !== "") {
      question = await this.rewriteQuestion(qwen, historyText, content);
    }

    // 2. 照片分析（本轮携带照片时；失败不降级，直接报错可重试）
    let photoDescription: string | undefined;
    if (photoUrls.length > 0) {
      photoDescription = await this.analyzePhotos(qwen, photoUrls);
    }

    // 3. 检索
    const retrievalQuery = normalizeEmbeddingText(question, photoDescription ?? "");
    if (retrievalQuery === "") {
      return await this.finishFallback(conversationId, userMessageId);
    }
    let vector: number[];
    try {
      vector = await this.embedding.embedQuery(retrievalQuery);
    } catch (error) {
      if (
        error instanceof EmbeddingConfigError ||
        error instanceof EmbeddingApiError
      ) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
    const allHits = await this.db.searchKnowledgeSegments(
      vector,
      this.embedding.currentModel(),
      config.retrievalK,
    );
    const hits = allHits.filter((hit) => hit.score >= config.hitThreshold);
    if (hits.length === 0) {
      return await this.finishFallback(conversationId, userMessageId);
    }

    // 4. 生成（视觉输入默认开启，可关）
    let replyText: string;
    try {
      replyText = await this.generateReply(qwen, {
        hits,
        historyText,
        photoDescription,
        question,
        photoUrls: config.visualInput ? photoUrls : [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        createLogMessage("Chat reply generation failed", {
          conversationId,
          error: message,
        }),
      );
      await this.insertAssistantMessage(conversationId, `生成失败，请重试：${message}`);
      throw new ServiceUnavailableException(`回答生成失败: ${message}`);
    }

    // 5. 三段式拼装（仅被引技巧）
    const cited = parseCitationNumbers(replyText, hits.length).map(
      (n) => hits[n - 1],
    );
    const reply = buildReplyPayload(replyText, cited);

    const assistantMessageId = await this.insertAssistantMessage(
      conversationId,
      reply.text,
      reply,
    );
    return { userMessageId, assistantMessageId, reply };
  }

  /** 兜底：命中为空 → 服务端固定兜底文案，不调用生成 */
  private async finishFallback(
    conversationId: number,
    userMessageId: number,
  ): Promise<{ userMessageId: number; assistantMessageId: number; reply: ChatReplyPayload }> {
    const assistantMessageId = await this.insertAssistantMessage(
      conversationId,
      CHAT_FALLBACK_TEXT,
    );
    return {
      userMessageId,
      assistantMessageId,
      reply: { text: CHAT_FALLBACK_TEXT, images: [], sources: [] },
    };
  }

  private async rewriteQuestion(
    qwen: QwenClient,
    historyText: string,
    content: string,
  ): Promise<string> {
    try {
      const result = await qwen.multimodalChat({
        stream: false,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: buildRewritePrompt(historyText, content),
          },
        ],
      });
      const question = (result.data as { question?: unknown }).question;
      if (typeof question === "string" && question.trim() !== "") {
        return question.trim();
      }
    } catch (error) {
      this.logger.warn(
        createLogMessage("Chat query rewrite failed; fallback to raw question", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return content;
  }

  private async analyzePhotos(
    qwen: QwenClient,
    photoUrls: string[],
  ): Promise<string> {
    const content: MultimodalContent[] = [
      { type: "text", text: PHOTO_ANALYSIS_PROMPT },
      ...photoUrls.map(
        (url): MultimodalContent => ({ type: "image_url", image_url: { url } }),
      ),
    ];
    const result = await qwen.multimodalChat({
      stream: false,
      enable_thinking: false,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    });
    const description = (result.data as { description?: unknown }).description;
    if (typeof description === "string" && description.trim() !== "") {
      return description.trim();
    }
    throw new Error("照片分析未返回有效描述");
  }

  private async generateReply(
    qwen: QwenClient,
    args: {
      hits: ChatHit[];
      historyText: string;
      photoDescription?: string;
      question: string;
      photoUrls: string[];
    },
  ): Promise<string> {
    const content: MultimodalContent[] = [
      {
        type: "text",
        text: buildAnswerUserPrompt({
          tipsText: buildTipsText(args.hits),
          historyText: args.historyText,
          photoDescription: args.photoDescription,
          question: args.question,
          photosAttached: args.photoUrls.length > 0,
        }),
      },
    ];
    if (args.photoUrls.length > 0 || hasAnyScreenshot(args.hits)) {
      const urls = [
        ...args.photoUrls,
        ...dedupeNonNull(args.hits.map((hit) => hit.screenshotUrl)),
      ].slice(0, MAX_VISUAL_IMAGES);
      for (const url of urls) {
        content.push({ type: "image_url", image_url: { url } });
      }
    }
    const result = await qwen.multimodalChat({
      stream: false,
      enable_thinking: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    const text = (result.data as { text?: unknown }).text;
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error("模型未返回回答正文");
    }
    return text.trim();
  }

  private async insertAssistantMessage(
    conversationId: number,
    content: string,
    reply?: ChatReplyPayload,
  ): Promise<number> {
    // 删除-生成并发：落库前校验会话仍存在，删除为准
    const conversation = await this.db.getConversation(conversationId);
    if (!conversation) {
      throw new NotFoundException(`会话已删除（id=${conversationId}）`);
    }
    return this.db.insertMessage({
      conversationId,
      role: "assistant",
      content,
      replyImages: reply?.images ?? undefined,
      replySources: reply?.sources ?? undefined,
    });
  }

  /** 沿用现有先例：读用户配置后自行构造 QwenClient（无共享 DI 先例） */
  private async createQwenClient(): Promise<QwenClient> {
    const settings = await this.db.getSettings(["llm.apiKey", "llm.modelName"]);
    const apiKey = settings["llm.apiKey"];
    const modelName = settings["llm.modelName"];
    if (!apiKey || !modelName) {
      throw new ServiceUnavailableException(
        "缺少 LLM 配置（llm.apiKey / llm.modelName），请先在设置页配置",
      );
    }
    const visionProxyUrl = process.env.QWEN_VISION_PROXY_URL;
    if (!visionProxyUrl) {
      throw new ServiceUnavailableException(
        "缺少 QWEN_VISION_PROXY_URL 配置，无法调用多模态模型",
      );
    }
    const config: LlmConfig = {
      apiKey,
      modelName,
      visionProxyUrl,
      visionProxyTimeoutMs: parseVisionProxyTimeoutMs(
        process.env.QWEN_VISION_PROXY_TIMEOUT_MS,
      ),
    };
    return new QwenClient(config);
  }
}

function parseVisionProxyTimeoutMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasAnyScreenshot(hits: ChatHit[]): boolean {
  return hits.some((hit) => hit.screenshotUrl != null);
}

function dedupeNonNull(urls: Array<string | null>): string[] {
  return [...new Set(urls.filter((url): url is string => url != null))];
}

/** 三段式拼装：images=被引技巧截图（去重），sources=被引技巧来源注脚（按技巧去重） */
export function buildReplyPayload(
  text: string,
  cited: ChatHit[],
): ChatReplyPayload {
  const images: ChatReplyPayload["images"] = [];
  const seenImageUrls = new Set<string>();
  const sources: ChatReplyPayload["sources"] = [];
  const seenSourceKeys = new Set<string>();
  for (const hit of cited) {
    if (hit.screenshotUrl && !seenImageUrls.has(hit.screenshotUrl)) {
      seenImageUrls.add(hit.screenshotUrl);
      images.push({
        url: hit.screenshotUrl,
        caption: hit.frameDescription,
        tipTitle: hit.title,
      });
    }
    const sourceKey = `${hit.videoUrl ?? ""}|${hit.timestampSeconds ?? ""}|${hit.title}`;
    if (!seenSourceKeys.has(sourceKey)) {
      seenSourceKeys.add(sourceKey);
      sources.push({
        videoTitle: hit.videoTitle,
        videoUrl: hit.videoUrl,
        timestampSeconds: hit.timestampSeconds,
        tipTitle: hit.title,
        screenshotUrl: hit.screenshotUrl,
        bvid: hit.bvid,
        cid: hit.cid,
      });
    }
  }
  return { text, images, sources };
}
