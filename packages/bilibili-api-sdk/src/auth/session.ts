import { CookieJar } from '../http/cookieJar.js'
import { generateBuvid3 } from './buvid.js'

/**
 * 会话状态：Cookie 登录态 + APP access_token + buvid。
 * 每个 BilibiliClient 持有自己的 Session，支持多账号。
 */
export interface SessionConfig {
  sessData?: string
  biliJct?: string
  dedeUserID?: string | number
  /** APP access_token（由 TV / APP 登录获得） */
  accessToken?: string
  buvid3?: string
  buvid4?: string
}

export class Session {
  readonly jar: CookieJar
  sessData = ''
  biliJct = ''
  dedeUserID = 0
  accessToken = ''
  buvid3 = ''
  buvid4 = ''

  constructor(config: SessionConfig = {}, jar?: CookieJar) {
    this.jar = jar ?? new CookieJar()
    this.apply(config)
    if (!this.buvid3) this.buvid3 = generateBuvid3()
    this.syncJar()
  }

  /** 设置登录态并同步到 cookieJar */
  apply(config: SessionConfig): void {
    if (config.sessData) this.sessData = config.sessData
    if (config.biliJct) this.biliJct = config.biliJct
    if (config.dedeUserID !== undefined) this.dedeUserID = Number(config.dedeUserID)
    if (config.accessToken) this.accessToken = config.accessToken
    if (config.buvid3) this.buvid3 = config.buvid3
    if (config.buvid4) this.buvid4 = config.buvid4
    this.syncJar()
  }

  private syncJar(): void {
    this.jar.setSession({
      sessData: this.sessData,
      biliJct: this.biliJct,
      dedeUserID: this.dedeUserID,
      buvid3: this.buvid3,
      buvid4: this.buvid4,
    })
  }

  /** csrf token（写操作使用） */
  get csrf(): string {
    return this.biliJct
  }

  get loggedIn(): boolean {
    return !!this.sessData
  }

  clear(): void {
    this.sessData = ''
    this.biliJct = ''
    this.dedeUserID = 0
    this.accessToken = ''
    this.jar.clear()
    this.buvid3 = generateBuvid3()
    this.syncJar()
  }

  /** 序列化会话（便于持久化） */
  toObject(): SessionConfig {
    return {
      sessData: this.sessData,
      biliJct: this.biliJct,
      dedeUserID: this.dedeUserID,
      accessToken: this.accessToken,
      buvid3: this.buvid3,
      buvid4: this.buvid4,
    }
  }
}
