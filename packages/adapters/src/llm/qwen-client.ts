/**
 * 千问 LLM API 客户端
 *
 * 封装千问 3.6 Flash 的 HTTP API 调用（OpenAI 兼容格式）
 * 支持纯文本（强制 JSON 输出）和多模态（文本 + 图片 URL/本地路径）调用
 */

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  visionProxyUrl?: string;
  visionModelName?: string;
}

/** 纯文本聊天请求 */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response_format?: { type: "json_object" };
}

/** 多模态消息内容块（文本或图片） */
export type MultimodalContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** 多模态消息 */
export interface MultimodalMessage {
  role: "system" | "user";
  content: string | MultimodalContent[];
}

/** 多模态聊天请求 */
export interface MultimodalRequest {
  model: string;
  messages: MultimodalMessage[];
}

function assertNoBase64ImageUrls(params: MultimodalRequest): void {
  for (const message of params.messages) {
    if (!Array.isArray(message.content)) continue;

    for (const item of message.content) {
      if (item.type !== "image_url") continue;

      const url = item.image_url.url.toLowerCase();
      if (url.startsWith("data:") || url.includes(";base64,")) {
        throw new Error("LLM 多模态图片禁止使用 Base64，请传入可访问的图片 URL 或本地文件路径");
      }
    }
  }
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
      throw new Error(`LLM API 调用失败 (${response.status}): ${err}`);
    }

    return parseOpenAiJsonResponse(await response.json(), "LLM 返回空响应");
  }

  /**
   * 多模态调用（文本 + 图片 URL/本地路径）
   */
  async multimodalChat(params: MultimodalRequest): Promise<object> {
    assertNoBase64ImageUrls(params);

    const requestBody = {
      ...params,
      model: params.model || this.config.visionModelName || this.config.modelName,
    };

    if (this.config.visionProxyUrl) {
      const response = await this.httpClient(this.config.visionProxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        throw new Error(`LLM 多模态代理调用失败 (${response.status}): ${err}`);
      }

      return parseOpenAiJsonResponse(await response.json(), "LLM 多模态代理返回空响应");
    }

    const url = `${this.config.baseUrl}/chat/completions`;
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
      throw new Error(`LLM 多模态调用失败 (${response.status}): ${err}`);
    }

    return parseOpenAiJsonResponse(await response.json(), "LLM 多模态返回空响应");
  }
}

function parseOpenAiJsonResponse(body: unknown, emptyMessage: string): object {
  const content = (body as {
    choices?: Array<{ message?: { content?: string } }>;
  }).choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(emptyMessage);
  }

  return JSON.parse(content) as object;
}
