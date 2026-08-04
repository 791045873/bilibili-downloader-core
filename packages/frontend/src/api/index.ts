import type {
  AiSummaryTaskEntry,
  DownloadConfig,
  ParseLinkResult,
  PaginatedTasks,
  PaginatedVideos,
  TaskStatusGroup,
  VideoInfo,
  ParseResultItem,
  TaskEntry,
  UserInfo,
} from "../types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ==================== 视频信息 ====================

export async function getVideoInfo(input: string): Promise<VideoInfo> {
  return request(`/video/info?input=${encodeURIComponent(input)}`);
}

export async function parseVideo(
  bvid: string,
  cid: number,
): Promise<ParseResultItem> {
  return request("/video/parse", {
    method: "POST",
    body: JSON.stringify({ bvid, cid }),
  });
}

export async function parseAllVideos(
  bvid: string,
  cids: number[],
): Promise<ParseResultItem[]> {
  return request("/video/parse-all", {
    method: "POST",
    body: JSON.stringify({ bvid, cids }),
  });
}

export async function parseLink(input: string): Promise<ParseLinkResult> {
  return request("/parse-link", {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function getUserSpaceVideos(
  mid: number,
  page: number,
  pageSize: number,
): Promise<PaginatedVideos> {
  return request(
    `/user-space/videos?mid=${mid}&page=${page}&pageSize=${pageSize}`,
  );
}

export async function getUgcSeasonVideos(
  seasonId: number,
  page: number,
  pageSize: number,
): Promise<PaginatedVideos> {
  return request(
    `/ugc-season/videos?seasonId=${seasonId}&page=${page}&pageSize=${pageSize}`,
  );
}

export async function getFavoritesVideos(
  mediaId: number,
  page: number,
  pageSize: number,
): Promise<PaginatedVideos> {
  return request(
    `/favorites/videos?mediaId=${mediaId}&page=${page}&pageSize=${pageSize}`,
  );
}

// ==================== 下载配置 ====================

export async function getDownloadConfig(): Promise<DownloadConfig> {
  return request("/download/config");
}

// ==================== 下载任务 ====================

export async function createDownload(req: {
  bvid: string;
  cid: number;
  title: string;
  quality?: number;
  codec?: string;
  outputPath?: string;
  subtitleLang?: string;
  autoSummary?: boolean;
}): Promise<{ id: number; message: string }> {
  return request("/download", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function stopTask(id: number): Promise<{ message: string }> {
  return request(`/tasks/${id}/stop`, { method: "POST" });
}

export async function resumeTask(id: number): Promise<{ message: string }> {
  return request(`/tasks/${id}/resume`, { method: "POST" });
}

export async function getTasks(params?: {
  page?: number;
  pageSize?: number;
  statusGroup?: TaskStatusGroup;
}): Promise<PaginatedTasks> {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  const statusGroup = params?.statusGroup ?? "all";
  return request(
    `/tasks?page=${page}&pageSize=${pageSize}&statusGroup=${statusGroup}`,
  );
}

export async function getTaskById(id: number): Promise<TaskEntry> {
  return request(`/tasks/${id}`);
}

export async function deleteTask(id: number): Promise<void> {
  await request(`/tasks/${id}`, { method: "DELETE" });
}

export async function clearTasks(): Promise<void> {
  await request("/tasks/clear", { method: "POST" });
}

// ==================== 任务检查（入队去重） ====================

export async function checkTasks(
  items: { bvid: string; cid: number }[],
): Promise<
  {
    id: number;
    bvid: string;
    cid: number;
    status: string;
    createdAt: string;
    autoSummary?: number;
  }[]
> {
  return request("/tasks/check", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function triggerAiSummary(req: {
  bvid: string;
  cid: number;
}): Promise<{ message: string }> {
  return request("/analysis/trigger", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function setAutoSummary(
  taskId: number,
  enabled: boolean,
): Promise<{ message: string }> {
  return request(`/tasks/${taskId}/auto-summary`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function triggerTaskAiSummary(
  taskId: number,
): Promise<{ message: string }> {
  return request(`/tasks/${taskId}/summary`, {
    method: "POST",
  });
}

export async function getAiSummaryTasks(): Promise<AiSummaryTaskEntry[]> {
  return request("/summary-tasks");
}

// ==================== 认证 ====================

export async function getQrCode(): Promise<{ qrcodeKey: string; url: string }> {
  return request("/auth/qrcode");
}

export async function getQrStatus(
  key: string,
): Promise<{ status: string; callbackUrl?: string; message?: string }> {
  return request(`/auth/qrcode/status?key=${encodeURIComponent(key)}`);
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  return request("/auth/user");
}
