import { basename } from "node:path";

const DEFAULT_TEXT_LIMIT = 180;

export function summarizeText(
  value: string,
  maxLength = DEFAULT_TEXT_LIMIT,
): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "empty";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function summarizeUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "empty url";
  }

  try {
    const parsed = new URL(normalized);
    const path = `${parsed.origin}${parsed.pathname}${parsed.search ? "?..." : ""}`;
    return summarizeText(path);
  } catch {
    return summarizeText(normalized);
  }
}

export function summarizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized) {
    return "empty path";
  }

  const fileName = basename(normalized);
  const segments = normalized.split("/").filter(Boolean);
  const parent = segments.length > 1 ? segments[segments.length - 2] : "";
  const summary = parent ? `.../${parent}/${fileName}` : fileName;
  return summarizeText(summary);
}

export function summarizeInput(value: string): string {
  return summarizeText(value, 120);
}

export function summarizeResponseBody(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "empty response body";
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const message = extractMessage(parsed);
    if (message) {
      return summarizeText(message);
    }

    const keys = Object.keys(parsed).slice(0, 5);
    return keys.length > 0
      ? `response keys=${keys.join(",")}`
      : "non-empty response body";
  } catch {
    return summarizeText(normalized);
  }
}

function extractMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const keys = ["message", "msg", "error", "detail", "error_description"];

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractMessage(candidate);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}
