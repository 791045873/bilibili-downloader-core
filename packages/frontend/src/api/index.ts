import type {
  ChatConversation,
  ChatMessage,
  ChatSendMessageResponse,
  AiPrompt,
  AiSummaryTaskStatus,
  DownloadConfig,
  ParseLinkResult,
  PaginatedAiSummaryTasks,
  PaginatedTasks,
  PaginatedVideos,
  PromptCreatorBinding,
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
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
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
  fileNameTemplate?: string;
  subtitleLang?: string;
  autoSummary?: boolean;
  promptId?: number;
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
  statusGroup?: TaskStatusGroup[];
}): Promise<PaginatedTasks> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 20),
    statusGroup: (params?.statusGroup ?? []).join(","),
  });
  return request(`/tasks?${q.toString()}`);
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
    summaryStatus?: string;
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
  promptId?: number;
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
  promptId?: number,
): Promise<{ message: string }> {
  return request(`/tasks/${taskId}/summary`, {
    method: "POST",
    body: JSON.stringify(promptId !== undefined ? { promptId } : {}),
  });
}

export async function getAiSummaryTasks(params?: {
  page?: number;
  pageSize?: number;
  status?: AiSummaryTaskStatus[];
  search?: string;
  updatedFrom?: string;
  updatedTo?: string;
}): Promise<PaginatedAiSummaryTasks> {
  const q = new URLSearchParams({
    page: String(params?.page ?? 1),
    pageSize: String(params?.pageSize ?? 20),
    status: (params?.status ?? []).join(","),
  });
  if (params?.search) q.set("search", params.search);
  if (params?.updatedFrom) q.set("updatedFrom", params.updatedFrom);
  if (params?.updatedTo) q.set("updatedTo", params.updatedTo);
  return request(`/summary-tasks?${q.toString()}`);
}

export async function getAiSummaryTaskRawResponse(
  id: number,
): Promise<{ rawResponse: string | null }> {
  return request(`/summary-tasks/${id}/raw-response`);
}

export interface SummaryMarkdownMeta {
  title?: string;
  videoUrl?: string;
  model?: string;
  createdAt?: string;
}

export async function getAiSummaryTaskMarkdown(
  id: number,
): Promise<{ content: string; meta: SummaryMarkdownMeta }> {
  return request(`/summary-tasks/${id}/markdown`);
}

export async function deleteAiSummaryTask(id: number): Promise<void> {
  await request(`/summary-tasks/${id}`, { method: "DELETE" });
}

export async function retriggerAiSummaryTask(
  id: number,
): Promise<{ message: string }> {
  return request(`/summary-tasks/${id}/retrigger`, { method: "POST" });
}

export async function rebuildAiSummaryTask(
  id: number,
): Promise<{ message: string }> {
  return request(`/summary-tasks/${id}/rebuild`, { method: "POST" });
}

export async function publishAiSummaryTask(
  id: number,
): Promise<{ message: string }> {
  return request(`/summary-tasks/${id}/publish`, { method: "POST" });
}

export async function startIntegrityCheck(): Promise<{ message: string }> {
  return request("/summary-tasks/integrity-check", { method: "POST" });
}

export async function getIntegrityCheckStatus(): Promise<{ running: boolean }> {
  return request("/summary-tasks/integrity-check/status");
}

export interface SummaryRepairItem {
  id?: number;
  bvid?: string;
  cid?: number;
  title?: string;
  reason?: string;
  summaryPath?: string;
  segmentCount?: number;
  empty?: boolean;
  queuedTaskId?: number;
}

export interface SummaryRepairReport {
  totalCompleted: number;
  pendingCount: number;
  repaired: SummaryRepairItem[];
  skipped: SummaryRepairItem[];
  failed: SummaryRepairItem[];
  deferred: SummaryRepairItem[];
}

export async function repairSummaryTasks(): Promise<{
  message: string;
  report: SummaryRepairReport;
}> {
  return request("/summary-tasks/repair", { method: "POST" });
}

// ==================== LLM 配置 ====================

export interface AnalysisLlmConfig {
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  modelName: string;
}

export async function getAnalysisConfig(): Promise<AnalysisLlmConfig> {
  return request("/analysis/config");
}

export async function updateAnalysisConfig(
  patch: Partial<{
    apiKey: string;
    modelName: string;
  }>,
): Promise<AnalysisLlmConfig> {
  return request("/analysis/config", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export interface AnalysisConfigTestResult {
  ok: boolean;
  model?: string;
  message?: string;
  error?: string;
}

export async function testAnalysisConfig(patch: {
  apiKey?: string;
  modelName?: string;
}): Promise<AnalysisConfigTestResult> {
  return request("/analysis/config/test", {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

// ==================== AI 总结提示词 ====================

export async function getPrompts(): Promise<{ items: AiPrompt[] }> {
  return request("/analysis/prompts");
}

export async function createPrompt(req: {
  name: string;
  content: string;
}): Promise<AiPrompt> {
  return request("/analysis/prompts", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function updatePrompt(
  id: number,
  req: { name?: string; content?: string },
): Promise<AiPrompt> {
  return request(`/analysis/prompts/${id}`, {
    method: "PUT",
    body: JSON.stringify(req),
  });
}

export async function deletePrompt(id: number): Promise<void> {
  await request(`/analysis/prompts/${id}`, { method: "DELETE" });
}

export async function setDefaultPrompt(id: number): Promise<AiPrompt> {
  return request(`/analysis/prompts/${id}/default`, { method: "PUT" });
}

export async function getPromptFormatSnippet(): Promise<{ snippet: string }> {
  return request("/analysis/prompts/format-snippet");
}

export async function getCreatorPromptBinding(
  mid: number,
): Promise<PromptCreatorBinding | null> {
  return request(`/analysis/prompts/creator?mid=${mid}`);
}

export async function setCreatorPromptBinding(
  mid: number,
  promptId: number,
): Promise<{ message: string }> {
  return request("/analysis/prompts/creator", {
    method: "PUT",
    body: JSON.stringify({ mid, promptId }),
  });
}

export async function deleteCreatorPromptBinding(
  mid: number,
): Promise<{ message: string }> {
  return request(`/analysis/prompts/creator?mid=${mid}`, {
    method: "DELETE",
  });
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

// ==================== RAG 穿搭问答 ====================

async function requestRaw<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function createChatConversation(): Promise<{ conversationId: number }> {
  return requestRaw("/chat/conversations", { method: "POST", body: JSON.stringify({}) });
}

export async function listChatConversations(): Promise<{ conversations: ChatConversation[] }> {
  return request("/chat/conversations");
}

export async function listChatMessages(
  conversationId: number,
): Promise<{ messages: ChatMessage[] }> {
  return request(`/chat/conversations/${conversationId}/messages`);
}

export async function uploadChatPhotos(
  conversationId: number,
  files: File[],
): Promise<{ photoUrls: string[] }> {
  const form = new FormData();
  for (const file of files) {
    form.append("photos", file);
  }
  return requestRaw(`/chat/conversations/${conversationId}/photos`, {
    method: "POST",
    body: form,
  });
}

export async function sendChatMessage(
  conversationId: number,
  content: string,
  photoUrls: string[],
): Promise<ChatSendMessageResponse> {
  return request(`/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, photoUrls }),
  });
}

export async function deleteChatConversation(conversationId: number): Promise<void> {
  await requestRaw(`/chat/conversations/${conversationId}`, { method: "DELETE" });
}

