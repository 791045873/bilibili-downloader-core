/**
 * 资源解析端口 - 将用户输入解析为统一资源标识
 */
export interface ResourceParserPort {
  /**
   * 解析用户输入，提取 bvid + cid
   * @throws {ResourceParseError} 当输入无法识别时
   */
  parse(input: string): Promise<ParseResult>;
}

export interface ParseResult {
  /** B 站视频 ID (BV 号)，合集时为 "" */
  bvid: string;

  /** 分 P ID (cid)，合集时为 0 */
  cid: number;

  /** 资源类型 */
  type: ResourceType;

  /** 原始 URL (如果是 URL 输入) */
  originalUrl?: string;

  /** 合集/收藏夹 media_id */
  mediaId?: number;

  /** 用户空间 mid */
  mid?: number;

  /** UGC 合集 season_id */
  seasonId?: number;
}

export enum ResourceType {
  Video = "video",
  Bangumi = "bangumi",
  Cheese = "cheese",
  Favorites = "favorites",
  UserSpace = "user-space",
  UgcSeason = "ugc-season",
}

export class ResourceParseError extends Error {
  constructor(
    message: string,
    public readonly input: string,
  ) {
    super(message);
    this.name = "ResourceParseError";
  }
}