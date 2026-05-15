import type { MediaStreamInfo } from "../domain/DownloadPlan.js";
import { ResourceType } from "./ResourceParserPort.js";

/**
 * 流信息提供端口 - 获取视频/音频的播放流列表和元信息
 */
export interface StreamProviderPort {
  /**
   * 获取视频元信息 (标题、分 P 列表、封面等)
   */
  getVideoInfo(bvid: string): Promise<VideoInfo>;

  /**
   * 获取播放流信息 (Dash/DURL 流列表)
   */
  getPlayStreams(input: StreamInput): Promise<PlayStreams>;
}

export interface VideoInfo {
  bvid: string;
  avid: number;
  title: string;
  /** 总时长 (秒) */
  duration: number;
  /** 封面 URL */
  coverUrl: string;
  /** 分 P 列表 */
  pages: VideoPage[];
}

export interface VideoPage {
  cid: number;
  page: number;
  title: string;
  duration: number;
}

export interface StreamInput {
  bvid: string;
  cid: number;
  /** 资源类型，用于区分视频/番剧/课程 API */
  resourceType: ResourceType;
  /** Cookie 字符串，用于需要登录的视频 */
  cookieString?: string;
}

export interface PlayStreams {
  /** DASH 视频流列表 */
  videoStreams: MediaStreamInfo[];
  /** DASH 音频流列表 */
  audioStreams: MediaStreamInfo[];
}