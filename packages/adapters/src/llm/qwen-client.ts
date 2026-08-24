/**
 * 千问 LLM 客户端
 *
 * 封装经 Python 视觉代理的多模态调用（本地媒体文件由代理机器上的 DashScope SDK 读取）。
 */

import { summarizeResponseBody, summarizeUrl } from "../safe-error-context.js";

const VISION_PROXY_DEFAULT_TIMEOUT_MS = 600_000;
const VISION_PROXY_MAX_ATTEMPTS = 2;
const VISION_PROXY_RETRY_DELAY_MS = 2000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 同时最多执行的大模型调用数（模块级，跨所有 QwenClient 实例生效） */
const MAX_CONCURRENT_LLM_CALLS = parsePositiveIntEnv(
  "MAX_CONCURRENT_LLM_CALLS",
  2,
);

/** 进程内并发信号量：最多 limit 个任务在途，超出排队等待（不拒绝） */
class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.active < this.limit) {
        this.active += 1;
        resolve();
        return;
      }
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

const llmConcurrencyLimiter = new AsyncLimiter(MAX_CONCURRENT_LLM_CALLS);

function isRetryableProxyStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LlmConfig {
  apiKey: string;
  modelName: string;
  visionProxyUrl?: string;
  visionProxyTimeoutMs?: number;
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
   * 多模态调用（文本 + 图片/视频 URL/本地路径）
   *
   * 仅支持经 Python 视觉代理调用：本地媒体路径需由代理所在机器读取。
   */
  async multimodalChat(
    params: MultimodalRequest,
  ): Promise<MultimodalChatResult> {
    assertNoBase64MediaUrls(params);

    if (!this.config.visionProxyUrl) {
      throw new Error(
        "LLM 多模态调用需要配置 QWEN_VISION_PROXY_URL（当前仅支持经 Python 视觉代理调用）",
      );
    }

    const requestBody = {
      ...params,
      model: this.config.modelName,
    };

    const visionProxyUrl = this.config.visionProxyUrl;
    const safeProxyEndpoint = summarizeUrl(visionProxyUrl);
    const timeoutMs =
      this.config.visionProxyTimeoutMs ?? VISION_PROXY_DEFAULT_TIMEOUT_MS;

    return llmConcurrencyLimiter.run(async () => {
      for (let attempt = 1; ; attempt++) {
        let response: Response;
        try {
          response = await fetchWithTimeout(
            this.httpClient,
            visionProxyUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.apiKey}`,
              },
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
    });
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
