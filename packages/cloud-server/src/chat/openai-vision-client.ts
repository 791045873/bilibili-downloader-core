/**
 * 云端多模态客户端（Stage C）：用 OpenAI 官方 Node SDK 连接所配置的
 * `QWEN_VISION_PROXY_URL`——该值是一个 OpenAI 兼容端点 URL，云端默认直连
 * DashScope compatible-mode（`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`），
 * 无需 Python vision-proxy（代理仅 NAS 用于读取本地视频文件）。
 *
 * baseURL = 去掉 URL 结尾的 `/chat/completions` 后缀；请求体与返回解析保持
 * DashScope 风格（含 `enable_thinking` 透传、`response_format` 透传、
 * `choices[0].message.content` → JSON.parse）。
 */

import OpenAI from "openai";
import type {
  LlmConfig,
  MultimodalContent,
  MultimodalRequest,
  MultimodalChatResult,
} from "@bilibili-downloader/adapters";

const VISION_PROXY_DEFAULT_TIMEOUT_MS = 600_000;
// 原 QwenClient 最多 2 次尝试（=1 次重试）；OpenAI SDK 的 maxRetries 即重试次数。
const VISION_PROXY_MAX_RETRIES = 1;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 同时最多执行的大模型调用数（模块级，跨所有实例生效，沿用原 QwenClient 口径） */
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

/**
 * 从完整的 vision proxy URL 推导 OpenAI SDK 的 baseURL。
 *
 * 代理 OpenAI 兼容端点为 `{base}/chat/completions`，而 `QWEN_VISION_PROXY_URL`
 * 配置的是完整端点（compose 默认 `http://vision-proxy:8765/v1/chat/completions`），
 * 故去掉结尾 `/chat/completions` 得到 baseURL；SDK 调用时会再拼回该后缀，最终命中
 * 同一端点（端点/配置不变）。若配置值未以该后缀结尾，则原样作为 baseURL。
 */
export function deriveOpenAiBaseUrl(fullUrl: string): string {
  const trimmed = fullUrl.replace(/\/+$/, "");
  const suffix = "/chat/completions";
  return trimmed.endsWith(suffix)
    ? trimmed.slice(0, trimmed.length - suffix.length)
    : trimmed;
}

function getMediaUrl(item: MultimodalContent): string | undefined {
  if (item.type === "image_url") return item.image_url.url;
  if (item.type === "video_url") return item.video_url.url;
  return undefined;
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

/**
 * 云端多模态客户端：接口与返回形状与 adapters 的 QwenClient 对齐，便于 chat 侧零改调用点。
 * 可注入 `fetchImpl` 以便单测断言请求形状、无需真实网络。
 */
export class OpenAiVisionClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LlmConfig, fetchImpl?: typeof fetch) {
    if (!config.visionProxyUrl) {
      throw new Error(
        "LLM 多模态调用需要配置 QWEN_VISION_PROXY_URL（OpenAI 兼容端点 URL，云端默认 DashScope compatible-mode）",
      );
    }
    this.model = config.modelName;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: deriveOpenAiBaseUrl(config.visionProxyUrl),
      timeout: config.visionProxyTimeoutMs ?? VISION_PROXY_DEFAULT_TIMEOUT_MS,
      maxRetries: VISION_PROXY_MAX_RETRIES,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  usesVisionProxy(): boolean {
    return true;
  }

  async multimodalChat(
    params: MultimodalRequest,
  ): Promise<MultimodalChatResult> {
    assertNoBase64MediaUrls(params);

    // 请求体保持 DashScope 风格：透传 messages / stream / enable_thinking /
    // response_format，并补 model。非标准字段（enable_thinking）由 SDK 原样序列化进 body。
    const body = { ...params, model: this.model };

    const completion = await llmConcurrencyLimiter.run(() =>
      this.client.chat.completions.create(
        body as unknown as Parameters<
          OpenAI["chat"]["completions"]["create"]
        >[0],
      ),
    );

    const rawContent = (
      completion as {
        choices?: Array<{ message?: { content?: string } }>;
      }
    ).choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error("LLM 多模态返回空响应");
    }

    return {
      data: JSON.parse(rawContent) as object,
      rawContent,
      model: this.model,
    };
  }
}
