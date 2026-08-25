// ---- 视频相关 ----

export interface VideoPage {
  cid: number;
  page: number;
  title: string;
  duration: number;
}

/** 合集信息 */
export interface UgcSeasonInfo {
  id: number;
  title: string;
  cover: string;
  sections: UgcSection[];
}

/** 合集下的子分类 */
export interface UgcSection {
  id: number;
  seasonId: number;
  title: string;
  episodes: UgcEpisode[];
}

/** 合集中的单个视频 */
export interface UgcEpisode {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pages: VideoPage[];
}

/** 服务端 /api/video/info 返回类型 */
export interface VideoInfo {
  bvid: string;
  cid: number;
  title: string;
  pages: VideoPage[];
  videoInfo: {
    bvid: string;
    avid: number;
    title: string;
    duration: number;
    coverUrl: string;
    upperName: string;
    upperMid: number;
    upperFace?: string;
    playCount: string;
    danmakuCount: string;
    publishTime: string;
    description: string;
    videoZone: string;
    typeId: number;
  };
  resourceType: string;
  originalUrl?: string;
  ugcSeason?: UgcSeasonInfo | null;
}

export interface VideoQualityOption {
  id: number;
  name: string;
  codecList: string[];
  selectedCodec: string;
}

export interface ParseResultItem {
  cid: number;
  videoQualityList: { id: number; name: string; codecList: string[] }[];
  audioQualityList: string[];
}

export interface VideoSummary {
  bvid: string;
  cid: number;
  title: string;
  cover?: string;
  duration: number;
}

export interface PaginatedVideos {
  items: VideoSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface UgcSeasonSummary {
  seasonId: number;
  title: string;
  cover?: string;
  videoCount: number;
}

export interface UserSpaceResult {
  mid: number;
  name: string;
  face?: string;
  videos: PaginatedVideos;
  seasons: UgcSeasonSummary[];
}

export interface UgcSeasonResult {
  seasonId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

export interface FavoritesResult {
  mediaId: number;
  title: string;
  cover?: string;
  upperName?: string;
  videos: PaginatedVideos;
}

export interface VideoParseResult {
  bvid: string;
  avid: number;
  title: string;
  duration: number;
  coverUrl: string;
  upperName: string;
  upperMid: number;
  upperFace?: string;
  playCount: string;
  danmakuCount: string;
  publishTime: string;
  description: string;
  videoZone: string;
  typeId: number;
  pages: VideoPage[];
  ugcSeason?: UgcSeasonInfo | null;
}

export interface ParseLinkResult {
  type: "video" | "user-space" | "ugc-season" | "favorites";
  data: VideoParseResult | UserSpaceResult | UgcSeasonResult | FavoritesResult;
}

// ---- 下载相关 ----

/** 服务端任务记录 */
export interface DownloadConfig {
  outputDir: string;
  source: "env" | "default";
}

export interface TaskEntry {
  id: number;
  bvid?: string;
  cid?: number;
  status: string;
  title?: string;
  progress?: number;
  speed?: string;
  outputFile?: string;
  fileSize?: number;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  autoSummary?: number;
  summaryStatus?: string;
  summaryOutput?: string;
  createdAt?: string;
  completedAt?: string;
}

export type TaskStatusGroup =
  | "all"
  | "active"
  | "created"
  | "downloading"
  | "success"
  | "failed"
  | "stopped";

export interface PaginatedTasks {
  items: TaskEntry[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface AiSummaryTaskEntry {
  id: number;
  bvid: string;
  cid: number;
  title?: string;
  sourceTaskId?: number;
  promptId?: number | null;
  status: string;
  summaryOutput?: string | null;
  errorMessage?: string | null;
  executionTiming?: { llmMs: number; screenshotMs: number; totalMs: number };
  modelName?: string | null;
  knowledgeStatus?: string | null;
  knowledgeError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastTriggeredAt?: string;
  lastCompletedAt?: string;
}

export type AiSummaryTaskStatus =
  | "all"
  | "pending"
  | "analyzing"
  | "failed"
  | "completed";

export interface PaginatedAiSummaryTasks {
  items: AiSummaryTaskEntry[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ---- AI 总结提示词 ----

export interface AiPrompt {
  id: number;
  name: string;
  content: string;
  isSystem: number;
  isDefault: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptCreatorBinding {
  mid: number;
  promptId: number;
}

// ---- 设置 ----

export interface AppSettings {
  autoParse: boolean;
  autoDownload: boolean;
  defaultQuality: number;
  defaultCodec: string;
  defaultAudioQuality: string;
  downloadDanmaku: boolean;
  downloadSubtitle: boolean;
  /** 默认输出文件名模板（占位符 {title}/{bvid}/{cid}/{quality}/{codec}，空则用服务端默认） */
  defaultFileNameTemplate: string;
}

// ---- 认证 ----

export interface UserInfo {
  mid: number;
  name: string;
  face: string;
  isLogin: boolean;
}

export type SubtitleLang = "none" | "zh" | "en" | "all";

export type LoginStatus = "pending" | "scanned" | "confirmed" | "expired";
