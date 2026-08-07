export { BilibiliClient, type ClientOptions } from './client.js'

export { BiliError } from './errors.js'

export { BilibiliHttp, DEFAULT_USER_AGENT, type HttpOptions, type HttpResult } from './http/http.js'
export { CookieJar, parseSetCookie, cookieDomainOf, type Cookie } from './http/cookieJar.js'

export { Session, type SessionConfig } from './auth/session.js'
export { WbiKeyManager, signWbi, extractWbiKeysFromUrl, type WbiKeys } from './auth/wbi.js'
export { appSign, appSignWith, APP_KEYS, type AppKeyName } from './auth/appSign.js'
export { BiliTicketManager } from './auth/biliTicket.js'
export { fetchBuvid, generateBuvid3 } from './auth/buvid.js'

export { BaseApi, type ApiContext, type RequestOptions, type ParamValue } from './api/base.js'
export { LoginApi } from './api/login.js'
export { VideoApi } from './api/video.js'
export { UserApi } from './api/user.js'
export { CommentApi } from './api/comment.js'
export { DynamicApi } from './api/dynamic.js'
export { SearchApi } from './api/search.js'
export { FavoriteApi } from './api/favorite.js'
export { HistoryApi } from './api/history.js'
export { DanmakuApi, parseDanmakuXml, decodeInflate, type DanmakuItem, type DanmakuResult } from './api/danmaku.js'
export { BangumiApi, CheeseApi, type PgcPlayUrlParams } from './api/pgc.js'
export { PlayerApi, type PlayerV2Params } from './api/player.js'

export type {
  VideoDetail,
  PlayUrlData,
  DashStream,
  DashStreamItem,
  DurlSegment,
  UgcSeason,
  UgcSeasonSection,
  UgcSeasonEpisode,
  VideoPage,
} from './models/video.js'
export type {
  PlayerV2Data,
  PlayerSubtitle,
  PlayerSubtitleItem,
  SubtitleJsonBody,
} from './models/player.js'
export type {
  NavInfo,
  SpaceAccInfo,
  SpaceArcSearchData,
  SpaceArchive,
  SeasonsSeriesListData,
  SeasonsArchivesListData,
} from './models/user.js'
export type { FavFolder, FavMedia, FavResourceList } from './models/favorite.js'
export { QrStatus, type QrGenerateResult, type QrPollResult } from './models/login.js'
