import type { LlmConfig } from "@bilibili-downloader/adapters/llm";
import { DatabaseService } from "@bilibili-downloader/server-common";

/** 解析 vision proxy 超时毫秒（非正数/非法 → undefined 走默认） */
export function parseVisionProxyTimeoutMs(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * nas 侧分析 LLM 配置（QwenClient / vision-proxy）。
 * 缺 apiKey/modelName 抛 Error（作业失败语义；cloud 侧为 BadRequestException，刻意不共享）。
 */
export async function getLlmConfig(db: DatabaseService): Promise<LlmConfig> {
  const stored = await db.getSettings(["llm.apiKey", "llm.modelName"]);
  const apiKey = stored["llm.apiKey"];
  const modelName = stored["llm.modelName"];
  const visionProxyUrl = process.env.QWEN_VISION_PROXY_URL;
  const visionProxyTimeoutMs = parseVisionProxyTimeoutMs(
    process.env.QWEN_VISION_PROXY_TIMEOUT_MS,
  );

  if (!apiKey || !modelName) {
    throw new Error("缺少 LLM 配置：请在设置页配置 API Key/模型");
  }

  return { apiKey, modelName, visionProxyUrl, visionProxyTimeoutMs };
}
