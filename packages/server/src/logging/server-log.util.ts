const SAFE_LOG_KEYS = new Set([
  "taskId",
  "analysisSubTaskId",
  "subTaskId",
  "bvid",
  "cid",
  "mid",
  "seasonId",
  "mediaId",
  "id",
  "enabled",
  "page",
  "pageSize",
  "itemCount",
  "count",
  "title",
  "input",
  "type",
  "status",
  "summaryStatus",
  "quality",
  "codec",
  "host",
  "source",
  "sourceType",
  "outputPath",
  "outputFile",
  "summaryDir",
  "summaryPath",
  "videoPath",
  "subtitlePath",
  "hasSubtitle",
  "hasScreenshotVideoPath",
  "autoSummary",
  "route",
  "method",
  "taskCount",
  "durationMs",
  "error",
  "reason",
  "queueLength",
  "runningCount",
  "maxConcurrency",
  "maxConcurrentLowRes",
  "requestedQuality",
  "requestedCodec",
  "availableQualityCount",
  "hasOutputPath",
  "downloadedQuality",
  "reuseHighRes",
  "timeoutMs",
  "success",
  "segmentCount",
  "emptySummary",
  "cleanup",
  "progress",
  "fromStatus",
  "toStatus",
  "fileExists",
  "taskStatus",
  "subTaskStatus",
  "existsInQueue",
  "existsRunning",
]);

export function createLogMessage(
  message: string,
  details?: Record<string, unknown>,
): string {
  const context = formatLogContext(details);
  return context ? `${message} ${context}` : message;
}

export function formatLogContext(
  details?: Record<string, unknown>,
): string | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized = sanitizeLogDetails(details);
  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return JSON.stringify(sanitized);
}

export function sanitizeLogDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizedEntries = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, sanitizeValue(key, value)] as const)
    .filter(([, value]) => value !== undefined);

  return Object.fromEntries(sanitizedEntries);
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function summarizeText(value: string, maxLength = 120): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function summarizePath(value: string): string {
  return summarizeText(value, 160);
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "string") {
    if (key === "host") {
      return value;
    }

    if (key.toLowerCase().includes("path") || key === "outputFile") {
      return summarizePath(value);
    }

    return summarizeText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return { count: value.length };
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const nestedEntries = Object.entries(objectValue)
      .filter(([nestedKey]) => SAFE_LOG_KEYS.has(nestedKey))
      .map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeValue(nestedKey, nestedValue),
      ])
      .filter(([, nestedValue]) => nestedValue !== undefined);

    if (nestedEntries.length === 0) {
      return { keys: Object.keys(objectValue).length };
    }

    return Object.fromEntries(nestedEntries);
  }

  return undefined;
}

export function buildRequestLogDetails(input: {
  method: string;
  route: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}): Record<string, unknown> {
  const details: Record<string, unknown> = {
    method: input.method,
    route: input.route,
  };

  const requestFields = collectSafeRequestFields(input.params, input.query);
  Object.assign(details, requestFields);

  if (input.body && typeof input.body === "object") {
    const bodyFields = collectSafeRequestFields(
      input.body as Record<string, unknown>,
    );
    Object.assign(details, bodyFields);
  }

  return details;
}

function collectSafeRequestFields(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const collected: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (!SAFE_LOG_KEYS.has(key)) {
        continue;
      }
      collected[key] = sanitizeValue(key, value);
    }
  }

  return collected;
}
