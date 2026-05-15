/**
 * Bilibili API 类型定义
 */

/** 播放流类型 */
export enum PlayStreamType {
  Video = "video",
  Bangumi = "bangumi",
  Cheese = "cheese",
}

/** 视频信息 API 响应 */
export interface BiliVideoInfo {
  bvid: string;
  aid: number;
  title: string;
  pic: string;
  duration: number;
  pages: BiliVideoPage[];
  stat: {
    view: number;
    danmaku: number;
    reply: number;
    favorite: number;
    coin: number;
    share: number;
    like: number;
  };
  owner: {
    mid: number;
    name: string;
    face: string;
  };
}

export interface BiliVideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

/** 播放流 API 响应 */
export interface BiliPlayUrlResponse {
  code: number;
  message: string;
  data: {
    accept_description: string[];
    accept_format: string;
    accept_quality: number[];
    dash: BiliDash;
    durl: BiliDurlItem[];
    format: string;
    quality: number;
    timelength: number;
    video_codecid: number;
  };
}

export interface BiliDash {
  video: BiliDashStream[];
  audio: BiliDashStream[];
  dolby?: {
    type: number;
    audio?: BiliDashStream[];
  };
  flac?: {
    display: boolean;
    audio?: BiliDashStream;
  };
}

export interface BiliDashStream {
  id: number;
  baseUrl: string;
  base_url: string;
  backupUrl: string[];
  backup_url: string[];
  bandwidth: number;
  mimeType: string;
  mime_type: string;
  codecs: string;
  codecid: number;
  width?: number;
  height?: number;
  frameRate?: string;
  frame_rate?: string;
  sar?: string;
  startWithSap?: number;
  start_with_sap?: number;
  segmentBase?: {
    Initialization: string;
    indexRange: string;
  };
  segment_base?: {
    initialization: string;
    index_range: string;
  };
}

export interface BiliDurlItem {
  order: number;
  length: number;
  size: number;
  url: string;
  backup_url: string[];
}

/** Nav API 响应 (WBI Key 来源) */
export interface BiliNavResponse {
  code: number;
  data: {
    isLogin: boolean;
    wbi_img: {
      img_url: string;
      sub_url: string;
    };
  };
}

/** 登录二维码生成响应 */
export interface BiliQrCodeResponse {
  code: number;
  message: string;
  data: {
    url: string;
    qrcode_key: string;
  };
}

/** 登录状态轮询响应 */
export interface BiliQrStatusResponse {
  code: number;
  message: string;
  data: {
    url: string;
    refresh_token: string;
    code: number;
    message: string;
  };
}