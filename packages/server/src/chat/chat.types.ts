/** multipart 上传文件的最小结构（AnyFilesInterceptor 产物结构兼容） */
export interface ChatPhotoFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname?: string;
}

/** 三段式回答的图片示例段 */
export interface ChatReplyImage {
  url: string;
  caption: string | null;
  tipTitle: string;
}

/** 三段式回答的视频注脚段 */
export interface ChatReplySource {
  videoTitle: string;
  videoUrl: string | null;
  timestampSeconds: number | null;
  tipTitle: string;
  screenshotUrl: string | null;
  bvid: string;
  cid: number;
}

/** 三段式回答对象（非流式 JSON） */
export interface ChatReplyPayload {
  text: string;
  images: ChatReplyImage[];
  sources: ChatReplySource[];
}

/** 一条命中技巧（检索结果 + 供引用拼装的元数据） */
export interface ChatHit {
  segmentId: number;
  title: string;
  content: string;
  score: number;
  screenshotUrl: string | null;
  frameDescription: string | null;
  timestampSeconds: number | null;
  videoTitle: string;
  videoUrl: string | null;
  bvid: string;
  cid: number;
}
