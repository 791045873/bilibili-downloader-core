import type { ResourceParserPort } from "../ports/ResourceParserPort.js";
import type { StreamProviderPort, PlayStreams } from "../ports/StreamProviderPort.js";
import type { AuthProviderPort } from "../ports/AuthProviderPort.js";
import type { MediaStreamInfo } from "../domain/DownloadPlan.js";
import type { ResolvedVideo, ResolveOptions, StreamResolveParams } from "../domain/ResolvedVideo.js";

/**
 * 解析服务 — 将视频下载流程中的解析阶段独立出来
 *
 * 提供三个公开能力：
 * 1. resolve()         — 阶段1: 解析输入 → 完整视频标识 + 元信息
 * 2. resolveStreams()  — 阶段2: 获取全部播放流（不做选择）
 * 3. selectBestStream()— 工具: 按偏好从流列表中选最佳流
 */
export class ResolutionService {
  constructor(
    private readonly resourceParser: ResourceParserPort,
    private readonly streamProvider: StreamProviderPort,
    private readonly authProvider?: AuthProviderPort,
  ) {}

  /**
   * 解析用户输入，返回完整的视频信息
   *
   * 包含: parse + getVideoInfo + 分P选择 + 标题拼接
   */
  async resolve(input: string, opts?: ResolveOptions): Promise<ResolvedVideo> {
    const parseResult = await this.resourceParser.parse(input);

    const videoInfo = await this.streamProvider.getVideoInfo(parseResult.bvid);

    const targetPageIndex = (opts?.page ?? 1) - 1; // 1-based → 0-based
    const targetPage = videoInfo.pages[targetPageIndex];

    if (!targetPage) {
      throw new Error(
        `分 P ${targetPageIndex + 1} 不存在 (共 ${videoInfo.pages.length}P)`,
      );
    }

    const cid = targetPage.cid;
    const pageSuffix =
      videoInfo.pages.length > 1 ? ` P${targetPageIndex + 1}` : "";
    const title = `${videoInfo.title}${pageSuffix}`;

    return {
      bvid: parseResult.bvid,
      cid,
      resourceType: parseResult.type,
      title,
      pages: videoInfo.pages,
      videoInfo,
      originalUrl: parseResult.originalUrl,
      ugcSeason: videoInfo.ugcSeason ?? null,
    };
  }

  /**
   * 获取播放流列表（全部流，不做选择）
   *
   * 适配层拿到 PlayStreams 后可以：
   * - 展示画质/编码选项给用户选择
   * - 用 selectBestStream() 按偏好自动选择
   * - 实现自己的选择逻辑
   */
  async resolveStreams(params: StreamResolveParams): Promise<PlayStreams> {
    return this.streamProvider.getPlayStreams({
      bvid: params.bvid,
      cid: params.cid,
      resourceType: params.resourceType,
      cookieString: params.cookieString,
    });
  }

  /**
   * 从流列表中按偏好选择最佳流
   *
   * 规则:
   * 1. 先按 codecPreference 过滤（模糊匹配）
   * 2. 再按 qualityPreference 精确匹配
   * 3. 从剩余候选中选最高清晰度
   */
  selectBestStream(
    streams: MediaStreamInfo[],
    codecPreference?: string,
    qualityPreference?: number,
  ): MediaStreamInfo | null {
    if (streams.length === 0) return null;

    let candidates = [...streams];

    // 按编码过滤（模糊匹配）
    if (codecPreference) {
      const filtered = candidates.filter((s) =>
        s.codec.toLowerCase().includes(codecPreference.toLowerCase()),
      );
      if (filtered.length > 0) candidates = filtered;
    }

    // 按清晰度过滤
    if (qualityPreference !== undefined) {
      const filtered = candidates.filter(
        (s) => s.quality === qualityPreference,
      );
      if (filtered.length > 0) candidates = filtered;
    }

    // 选最高清晰度
    candidates.sort((a, b) => b.quality - a.quality);
    return candidates[0];
  }
}