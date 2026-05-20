import type { VideoInfo, VideoPage, UgcSeasonInfo } from "../ports/StreamProviderPort.js";
import type { ResourceType } from "../ports/ResourceParserPort.js";

/**
 * 解析阶段完成后的完整视频信息
 */
export interface ResolvedVideo {
  bvid: string;
  cid: number;
  resourceType: ResourceType;
  title: string;
  pages: VideoPage[];
  videoInfo: VideoInfo;
  originalUrl?: string;
  /** 合集信息（该视频所属的 UGC 合集，无合集时为 null） */
  ugcSeason?: UgcSeasonInfo | null;
}

/** resolve() 方法的选项 */
export interface ResolveOptions {
  /** 指定分P，1-based，默认1 */
  page?: number;
  /** Cookie文件路径 */
  cookieFile?: string;
}

/** resolveStreams() 方法的参数 */
export interface StreamResolveParams {
  bvid: string;
  cid: number;
  resourceType: ResourceType;
  cookieString?: string;
}