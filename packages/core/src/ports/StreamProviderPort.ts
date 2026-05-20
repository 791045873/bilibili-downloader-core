import type { MediaStreamInfo } from "../domain/DownloadPlan.js";
import { ResourceType } from "./ResourceParserPort.js";

/**
 * 流信息提供端口 - 获取视频/音频的播放流列表和元信息
 */
export interface StreamProviderPort {
  getVideoInfo(bvid: string): Promise<VideoInfo>;
  getPlayStreams(input: StreamInput): Promise<PlayStreams>;
}

// ---- 视频元信息 ----

export interface VideoInfo {
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
  /** 合集信息（该视频所属的 UGC 合集，无合集时为 undefined） */
  ugcSeason?: UgcSeasonInfo;
}

// ---- 合集三级结构 ----

export interface UgcSeasonInfo {
  id: number;
  title: string;
  cover: string;
  sections: UgcSection[];
}

export interface UgcSection {
  id: number;
  seasonId: number;
  title: string;
  episodes: UgcEpisode[];
}

export interface UgcEpisode {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pages: VideoPage[];
}

// ---- 分 P / 流输入 / 播放流 ----

export interface VideoPage {
  cid: number;
  page: number;
  title: string;
  duration: number;
}

export interface StreamInput {
  bvid: string;
  cid: number;
  resourceType: ResourceType;
  cookieString?: string;
}

export interface PlayStreams {
  videoStreams: MediaStreamInfo[];
  audioStreams: MediaStreamInfo[];
}