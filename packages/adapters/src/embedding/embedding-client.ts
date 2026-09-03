/**
 * DashScope OpenAI 兼容端点 embedding 客户端（纯 HTTP，配置由上层解析注入）。
 */

export interface EmbeddingClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

export const EMBEDDING_BATCH_LIMIT = 20;
export const EMBEDDING_TIMEOUT_MS = 30_000;

export class EmbeddingApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingApiError";
  }
}

export class EmbeddingClient {
  constructor(
    private readonly config: EmbeddingClientConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  /** 单批调用（调用方保证 texts.length ≤ 20），返回与输入顺序一致的向量 */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > EMBEDDING_BATCH_LIMIT) {
      throw new EmbeddingApiError(
        `embedding 单批上限 ${EMBEDDING_BATCH_LIMIT} 条，收到 ${texts.length} 条`,
      );
    }
    let response: Response;
    try {
      response = await this.httpClient(
        `${this.config.baseUrl.replace(/\/+$/, "")}/embeddings`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.model,
            input: texts,
            dimensions: this.config.dimensions,
          }),
          signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
        },
      );
    } catch (err) {
      throw new EmbeddingApiError(
        `embedding 调用失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new EmbeddingApiError(
        `embedding 调用失败 (status=${response.status}): ${body.slice(0, 300)}`,
      );
    }
    const body = (await response.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const data = body.data ?? [];
    if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding))) {
      throw new EmbeddingApiError(
        `embedding 响应不完整: 期望 ${texts.length} 条，收到 ${data.length} 条`,
      );
    }
    return data
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding!);
  }
}
