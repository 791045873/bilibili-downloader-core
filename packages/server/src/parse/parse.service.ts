import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  OnModuleInit,
} from "@nestjs/common";
import {
  BilibiliFavoritesProvider,
  BilibiliResourceParser,
  BilibiliSpaceProvider,
  BilibiliStreamProvider,
  createBilibiliWebClient,
} from "@bilibili-downloader/adapters/bilibili";
import { BilibiliAuthProvider } from "@bilibili-downloader/adapters/bilibili-auth";
import { ResolutionService } from "@bilibili-downloader/core/usecases";
import {
  ResourceType,
  ResourceParseError,
  type FavoritesResult,
  type PaginatedVideos,
  type ParseLinkResult,
  type UgcSeasonResult,
  type UserSpaceResult,
} from "@bilibili-downloader/core/ports";
import { join } from "node:path";

@Injectable()
export class ParseService implements OnModuleInit {
  private readonly outputDir: string;
  private readonly cookieFile: string;

  private authProvider!: BilibiliAuthProvider;
  private resourceParser!: BilibiliResourceParser;
  private streamProvider!: BilibiliStreamProvider;
  private favoritesProvider!: BilibiliFavoritesProvider;
  private spaceProvider!: BilibiliSpaceProvider;
  private resolutionService!: ResolutionService;

  private cookieString?: string;

  constructor() {
    this.outputDir = process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads");
    this.cookieFile =
      process.env.COOKIE_FILE || join(this.outputDir, ".cookies.json");
  }

  async onModuleInit(): Promise<void> {
    this.authProvider = new BilibiliAuthProvider();
    this.cookieString = await this.loadCookieString(this.cookieFile);

    const webClient = createBilibiliWebClient({
      cookieString: this.cookieString,
    });
    this.resourceParser = new BilibiliResourceParser(webClient);
    this.streamProvider = new BilibiliStreamProvider(webClient);
    this.favoritesProvider = new BilibiliFavoritesProvider(webClient);
    this.spaceProvider = new BilibiliSpaceProvider(webClient);
    this.resolutionService = new ResolutionService(
      this.resourceParser,
      this.streamProvider,
      this.authProvider,
    );
  }

  async parseLink(input: string): Promise<ParseLinkResult> {
    const parseResult = await this.resourceParser.parse(input);

    switch (parseResult.type) {
      case ResourceType.Video: {
        const resolved = await this.resolutionService.resolve(input);
        return {
          type: "video",
          data: {
            ...resolved.videoInfo,
            ugcSeason: resolved.videoInfo.ugcSeason
              ? {
                  seasonId: resolved.videoInfo.ugcSeason.id,
                  title: resolved.videoInfo.ugcSeason.title,
                  cover: resolved.videoInfo.ugcSeason.cover,
                  sections: resolved.videoInfo.ugcSeason.sections,
                }
              : undefined,
          },
        };
      }
      case ResourceType.UserSpace: {
        const mid = parseResult.mid;
        if (!mid) {
          throw new BadRequestException("用户空间链接缺少 mid");
        }
        const [user, videos, seasons] = await Promise.all([
          this.spaceProvider.getUserInfo(mid, this.cookieString),
          this.spaceProvider.getUserVideos(mid, 1, 20, this.cookieString),
          this.spaceProvider.getUserSeasons(mid, this.cookieString),
        ]);
        const result: UserSpaceResult = {
          mid: user.mid,
          name: user.name,
          face: user.face,
          videos,
          seasons,
        };
        return { type: "user-space", data: result };
      }
      case ResourceType.UgcSeason: {
        const seasonId = parseResult.seasonId;
        const mid = parseResult.mid;
        if (!seasonId) {
          throw new BadRequestException("UGC 合集链接缺少 seasonId");
        }
        const [videosPage, seasons] = await Promise.all([
          this.spaceProvider.getUgcSeasonVideos(
            seasonId,
            1,
            20,
            this.cookieString,
          ),
          mid
            ? this.spaceProvider.getUserSeasons(mid, this.cookieString)
            : Promise.resolve([]),
        ]);

        const seasonMeta = seasons.find((s) => s.seasonId === seasonId);
        const result: UgcSeasonResult = {
          seasonId,
          title: videosPage.title || seasonMeta?.title || "",
          cover: videosPage.cover || seasonMeta?.cover,
          upperName: videosPage.upperName,
          videos: {
            items: videosPage.items,
            page: videosPage.page,
            pageSize: videosPage.pageSize,
            total: videosPage.total,
            hasMore: videosPage.hasMore,
          },
        };
        return { type: "ugc-season", data: result };
      }
      case ResourceType.Favorites: {
        const mediaId = parseResult.mediaId;
        if (!mediaId) {
          throw new BadRequestException("收藏夹链接缺少 mediaId");
        }
        const [info, page] = await Promise.all([
          this.favoritesProvider.getFavoritesInfo(mediaId, this.cookieString),
          this.favoritesProvider.getFavoritesVideos(
            mediaId,
            1,
            20,
            this.cookieString,
          ),
        ]);

        const videos: PaginatedVideos = {
          items: page.videos.map((v) => ({
            bvid: v.bvid,
            cid: 0,
            title: v.title,
            cover: v.coverUrl,
            duration: v.duration,
          })),
          page: 1,
          pageSize: 20,
          total: info.mediaCount,
          hasMore: page.hasMore,
        };

        const result: FavoritesResult = {
          mediaId,
          title: info.title,
          cover: info.coverUrl,
          videos,
        };
        return { type: "favorites", data: result };
      }
      default:
        throw new BadRequestException("不支持的链接类型");
    }
  }

  async getUserSpaceVideos(
    mid: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedVideos> {
    return this.spaceProvider.getUserVideos(
      mid,
      page,
      pageSize,
      this.cookieString,
    );
  }

  async getUgcSeasonVideos(
    seasonId: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedVideos> {
    const pageResult = await this.spaceProvider.getUgcSeasonVideos(
      seasonId,
      page,
      pageSize,
      this.cookieString,
    );
    return {
      items: pageResult.items,
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      total: pageResult.total,
      hasMore: pageResult.hasMore,
    };
  }

  async getFavoritesVideos(
    mediaId: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedVideos> {
    const [info, pageResult] = await Promise.all([
      this.favoritesProvider.getFavoritesInfo(mediaId, this.cookieString),
      this.favoritesProvider.getFavoritesVideos(
        mediaId,
        page,
        pageSize,
        this.cookieString,
      ),
    ]);

    return {
      items: pageResult.videos.map((v) => ({
        bvid: v.bvid,
        cid: 0,
        title: v.title,
        cover: v.coverUrl,
        duration: v.duration,
      })),
      page,
      pageSize,
      total: info.mediaCount,
      hasMore: pageResult.hasMore,
    };
  }

  mapApiError(err: unknown): never {
    if (err instanceof BadRequestException) {
      throw err;
    }
    if (err instanceof ResourceParseError) {
      throw new BadRequestException(err.message);
    }

    const msg = err instanceof Error ? err.message : String(err);
    throw new BadGatewayException(msg);
  }

  private async loadCookieString(file: string): Promise<string | undefined> {
    try {
      const cookies = await this.authProvider.loadCookies(file);
      return this.authProvider.toCookieString(cookies);
    } catch {
      return undefined;
    }
  }
}
