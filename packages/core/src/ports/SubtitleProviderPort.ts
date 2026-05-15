/**
 * 字幕提供端口 - 获取视频字幕并转换为 SRT
 */

export interface SubtitleProviderPort {
  /**
   * 获取视频的所有字幕列表
   * @returns 字幕信息数组, 无字幕时返回空数组
   */
  fetchSubtitles(bvid: string, cid: number, cookieString?: string): Promise<SubtitleInfo[]>;
}

export interface SubtitleInfo {
  /** 语言标识 (如 "zh-CN", "en-US") */
  langKey: string;
  /** 语言显示名 (如 "中文(简体)", "English") */
  langName: string;
  /** SRT 格式的字幕内容 */
  srtContent: string;
}