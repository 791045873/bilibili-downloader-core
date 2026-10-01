export interface ChatConfig {
  visualInput: boolean;
  hitThreshold: number;
  historyRounds: number;
  retrievalK: number;
  photoMaxEdge: number;
  photoJpegQuality: number;
  photoMaxUploadMb: number;
  photoMaxPerMessage: number;
}

export const CHAT_FALLBACK_TEXT = "知识库暂无相关内容";

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function getChatConfig(): ChatConfig {
  return {
    visualInput: readBoolEnv("CHAT_VISUAL_INPUT", true),
    hitThreshold: readFloatEnv("CHAT_HIT_THRESHOLD", 0.3, 0, 1),
    historyRounds: readIntEnv("CHAT_HISTORY_ROUNDS", 6, 0, 50),
    retrievalK: readIntEnv("CHAT_RETRIEVAL_K", 10, 1, 50),
    photoMaxEdge: readIntEnv("PHOTO_MAX_EDGE", 1600, 200, 8000),
    photoJpegQuality: readIntEnv("PHOTO_JPEG_QUALITY", 80, 30, 100),
    photoMaxUploadMb: readIntEnv("PHOTO_MAX_UPLOAD_MB", 10, 1, 50),
    photoMaxPerMessage: readIntEnv("PHOTO_MAX_PER_MESSAGE", 3, 1, 9),
  };
}
