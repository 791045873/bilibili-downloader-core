import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import {
  BilibiliFavoritesProvider,
  BilibiliResourceParser,
  BilibiliSpaceProvider,
  BilibiliStreamProvider,
  FileCacheStore,
  createBilibiliSdkClient,
} from "@bilibili-downloader/adapters/bilibili";
import type { BilibiliSdkClient } from "@bilibili-downloader/adapters/bilibili";
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
import { resolveCloudBiliApiCacheDir } from "../config/bili-cache.js";
import { DatabaseService, createLogMessage } from "@bilibili-downloader/server-common";

@Injectable()
export class ParseService implements OnModuleInit {
  private readonly logger = new Logger(ParseService.name);
  private readonly outputDir: string;
  private readonly cacheDir: string;

  private biliClient!: BilibiliSdkClient;
  private authProvider!: BilibiliAuthProvider;
  private resourceParser!: BilibiliResourceParser;
  private streamProvider!: BilibiliStreamProvider;
  private favoritesProvider!: BilibiliFavoritesProvider;
  private spaceProvider!: BilibiliSpaceProvider;
  private resolutionService!: ResolutionService;

  private cookieString?: string;
  private cookieVersion = 0;

  constructor(private readonly db: DatabaseService) {
    this.outputDir = process.env.OUTPUT_DIR ?? "";
    this.cacheDir = resolveCloudBiliApiCacheDir();
  }

  async onModuleInit(): Promise<void> {
    this.authProvider = new BilibiliAuthProvider();
    const { cookie, version } = await this.db.getBiliCookie();
    this.cookieString = cookie;
    this.cookieVersion = version;

    this.biliClient = createBilibiliSdkClient(this.cookieString, {
      cacheStore: new FileCacheStore(this.cacheDir),
    });
    this.resourceParser = new BilibiliResourceParser();
    this.streamProvider = new BilibiliStreamProvider(this.biliClient);
    this.favoritesProvider = new BilibiliFavoritesProvider(this.biliClient);
    this.spaceProvider = new BilibiliSpaceProvider(this.biliClient);
    this.resolutionService = new ResolutionService(
      this.resourceParser,
      this.streamProvider,
      this.authProvider,
    );

    this.logger.log(
      createLogMessage("Parse service initialized", {
        outputPath: this.outputDir,
        hasCookie: Boolean(this.cookieString),
        cookieVersion: this.cookieVersion,
      }),
    );
  }

  async parseLink(input: string): Promise<ParseLinkResult> {
    await this.refreshCookieIfChanged();
    const parseResult = await this.resourceParser.parse(input);
    this.logger.log(
      createLogMessage("Resolved parse-link resource type", {
        input,
        type: parseResult.type,
        mid: "mid" in parseResult ? parseResult.mid : undefined,
        seasonId: "seasonId" in parseResult ? parseResult.seasonId : undefined,
        mediaId: "mediaId" in parseResult ? parseResult.mediaId : undefined,
      }),
    );

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
          this.spaceProvider.getUserSeasons(mid, 1, 20, this.cookieString),
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
            ? this.spaceProvider.getUserSeasons(mid, 1, 20, this.cookieString)
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
    await this.refreshCookieIfChanged();
    this.logger.log(
      createLogMessage("Fetching user space videos", {
        mid,
        page,
        pageSize,
      }),
    );
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
    await this.refreshCookieIfChanged();
    this.logger.log(
      createLogMessage("Fetching UGC season videos", {
        seasonId,
        page,
        pageSize,
      }),
    );
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
    await this.refreshCookieIfChanged();
    this.logger.log(
      createLogMessage("Fetching favorites videos", {
        mediaId,
        page,
        pageSize,
      }),
    );
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
      this.logger.warn(
        createLogMessage("Parse service rejected request", {
          error: err.message,
        }),
      );
      throw err;
    }
    if (err instanceof ResourceParseError) {
      this.logger.warn(
        createLogMessage("Parse service rejected unsupported resource", {
          error: err.message,
        }),
      );
      throw new BadRequestException(err.message);
    }

    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(
      createLogMessage("Parse service upstream request failed", {
        error: msg,
      }),
      err instanceof Error ? err.stack : undefined,
    );
    throw new BadGatewayException(msg);
  }

  /** 对外解析/取流前按版本刷新 cookie：版本未变不动，变化则重取并刷新 SDK 客户端。 */
  private async refreshCookieIfChanged(): Promise<void> {
    const version = await this.db.getBiliCookieVersion();
    if (version === this.cookieVersion) return;
    const { cookie, version: latest } = await this.db.getBiliCookie();
    this.biliClient.setCookieString(cookie);
    this.cookieString = cookie;
    this.cookieVersion = latest;
  }
}
