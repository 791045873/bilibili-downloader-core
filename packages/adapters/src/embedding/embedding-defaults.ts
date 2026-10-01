/**
 * embedding 默认配置常量与文本归一化。
 *
 * 这些是**向量复用键**的一部分（模型/维度/基址 + 文本归一化规则）：cloud 与 nas 两侧
 * 必须逐字一致，否则同一文本会产生不同向量键，导致去重失效、重复计费、检索错配。
 * 故集中落在 adapters 单一真源，两侧 wrapper 从此导入，杜绝漂移。
 */

export const DEFAULT_EMBEDDING_MODEL = "qwen3.7-text-embedding";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_EMBEDDING_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

export class EmbeddingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigError";
  }
}

/** 向量复用键文本归一化：折叠空白、去空段、单空格连接。cloud/nas 必须一致。 */
export function normalizeEmbeddingText(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .join(" ");
}
