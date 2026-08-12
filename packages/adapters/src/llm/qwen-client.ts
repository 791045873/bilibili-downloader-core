/**
 * 千问 LLM API 客户端
 *
 * 封装千问 3.6 Flash 的 HTTP API 调用（OpenAI 兼容格式）
 * 支持纯文本（强制 JSON 输出）和多模态（文本 + 图片/视频 URL/本地路径）调用
 */

import { summarizeResponseBody, summarizeUrl } from "../safe-error-context.js";

const VISION_PROXY_DEFAULT_TIMEOUT_MS = 600_000;
const VISION_PROXY_MAX_ATTEMPTS = 2;
const VISION_PROXY_RETRY_DELAY_MS = 2000;

function isRetryableProxyStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  visionProxyUrl?: string;
  visionModelName?: string;
  visionProxyTimeoutMs?: number;
}

/** 纯文本聊天请求 */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response_format?: { type: "json_object" };
}

/** 多模态消息内容块（文本、图片或视频） */
export type MultimodalContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

/** 多模态消息 */
export interface MultimodalMessage {
  role: "system" | "user";
  content: string | MultimodalContent[];
}

/** 多模态聊天请求 */
export interface MultimodalRequest {
  model: string;
  messages: MultimodalMessage[];
  stream?: boolean;
  enable_thinking?: boolean;
  response_format?: { type: "json_object" };
}

/** 多模态聊天结果：解析后的数据 + 模型返回的原始 content 原文 + 实际使用模型 */
export interface MultimodalChatResult {
  data: object;
  rawContent: string;
  model: string;
}

function assertNoBase64MediaUrls(params: MultimodalRequest): void {
  for (const message of params.messages) {
    if (!Array.isArray(message.content)) continue;

    for (const item of message.content) {
      const url = getMediaUrl(item)?.toLowerCase();
      if (!url) continue;

      if (url.startsWith("data:") || url.includes(";base64,")) {
        throw new Error(
          "LLM 多模态媒体禁止使用 Base64，请传入可访问的媒体 URL 或本地文件路径",
        );
      }
    }
  }
}

function getMediaUrl(item: MultimodalContent): string | undefined {
  if (item.type === "image_url") return item.image_url.url;
  if (item.type === "video_url") return item.video_url.url;
  return undefined;
}

export class QwenClient {
  private readonly config: LlmConfig;

  constructor(
    config: LlmConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {
    this.config = config;
  }

  usesVisionProxy(): boolean {
    return Boolean(this.config.visionProxyUrl);
  }

  /**
   * 纯文本调用，强制 JSON 输出格式
   */
  async chatCompletion(params: ChatCompletionRequest): Promise<object> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const safeEndpoint = summarizeUrl(url);
    const response = await this.httpClient(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        ...params,
        model: params.model || this.config.modelName,
        response_format: params.response_format ?? { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText);
      throw new Error(
        `LLM API 调用失败 (status=${response.status}, endpoint=${safeEndpoint}): ${summarizeResponseBody(err || response.statusText)}`,
      );
    }

    return JSON.parse(
      extractRawContent(await response.json(), "LLM 返回空响应"),
    ) as object;
  }

  /**
   * 多模态调用（文本 + 图片/视频 URL/本地路径）
   */
  async multimodalChat(
    params: MultimodalRequest,
  ): Promise<MultimodalChatResult> {
    assertNoBase64MediaUrls(params);

    const requestBody = {
      ...params,
      model:
        params.model || this.config.visionModelName || this.config.modelName,
    };

    if (this.config.visionProxyUrl) {
      const safeProxyEndpoint = summarizeUrl(this.config.visionProxyUrl);
      const timeoutMs =
        this.config.visionProxyTimeoutMs ?? VISION_PROXY_DEFAULT_TIMEOUT_MS;

      for (let attempt = 1; ; attempt++) {
        let response: Response;
        try {
          response = await fetchWithTimeout(
            this.httpClient,
            this.config.visionProxyUrl,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            },
            timeoutMs,
          );
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error(
              `LLM 多模态代理调用超时 (${timeoutMs}ms, endpoint=${safeProxyEndpoint})`,
            );
          }
          if (attempt < VISION_PROXY_MAX_ATTEMPTS) {
            await delay(VISION_PROXY_RETRY_DELAY_MS);
            continue;
          }
          throw err;
        }

        if (!response.ok) {
          const err = await response.text().catch(() => response.statusText);
          if (
            isRetryableProxyStatus(response.status) &&
            attempt < VISION_PROXY_MAX_ATTEMPTS
          ) {
            await delay(VISION_PROXY_RETRY_DELAY_MS);
            continue;
          }
          throw new Error(
            `LLM 多模态代理调用失败 (status=${response.status}, endpoint=${safeProxyEndpoint}): ${summarizeResponseBody(err || response.statusText)}`,
          );
        }

        const rawBody = await response.json();
        const rawContent = extractRawContent(
          rawBody,
          "LLM 多模态代理返回空响应",
        );
        return {
          data: JSON.parse(rawContent) as object,
          rawContent,
          model: requestBody.model,
        };
      }
    }

    const url = `${this.config.baseUrl}/chat/completions`;
    const safeEndpoint = summarizeUrl(url);
    const response = await this.httpClient(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText);
      throw new Error(
        `LLM 多模态调用失败 (status=${response.status}, endpoint=${safeEndpoint}): ${summarizeResponseBody(err || response.statusText)}`,
      );
    }

    const rawBody = await response.json();
    const rawContent = extractRawContent(rawBody, "LLM 多模态返回空响应");
    return {
      data: JSON.parse(rawContent) as object,
      rawContent,
      model: requestBody.model,
    };
  }
}

async function fetchWithTimeout(
  httpClient: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await httpClient(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractRawContent(body: unknown, emptyMessage: string): string {
  const content = (
    body as {
      choices?: Array<{ message?: { content?: string } }>;
    }
  ).choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(emptyMessage);
  }

  return content;
}
