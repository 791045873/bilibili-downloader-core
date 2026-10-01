import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseService } from "@bilibili-downloader/server-common";
import { createLogMessage } from "@bilibili-downloader/server-common";
import type { AuthUser } from "./auth.constants.js";
import { verifyPassword } from "./password.util.js";

/** 用户名不存在时用于等时比较的哑哈希（抗用户名枚举的时序差异） */
const DUMMY_PASSWORD_HASH =
  "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

/** 登录结果：成功 / 凭据无效（统一口径）/ IP 暂时封禁 */
export type LoginOutcome =
  | { ok: true; result: LoginResult }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number };

/** 登录口令长度上限：公开端点，避免超长输入放大 scrypt 开销 */
const MAX_PASSWORD_LENGTH = 200;

/** 失败计数表条目上限：超过则惰性清扫过期条目（公开端点，防内存无界增长） */
const MAX_FAILURE_ENTRIES = 5000;

interface FailureState {
  count: number;
  firstAt: number;
  blockedUntil?: number;
}


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failures = new Map<string, FailureState>();

  private readonly sessionTtlMs: number;
  private readonly maxFailures: number;
  private readonly failureWindowMs: number;
  private readonly blockMs: number;
  private readonly cookieSecure: boolean;

  constructor(private readonly db: DatabaseService) {
    this.sessionTtlMs =
      (Number(process.env.SESSION_TTL_HOURS) || 168) * 3600_000;
    this.maxFailures = Number(process.env.LOGIN_MAX_FAILURES) || 5;
    this.failureWindowMs =
      (Number(process.env.LOGIN_FAILURE_WINDOW_MINUTES) || 15) * 60_000;
    this.blockMs = (Number(process.env.LOGIN_BLOCK_MINUTES) || 15) * 60_000;
    // 显式开关而非 NODE_ENV：本仓不以 NODE_ENV 作生产判据（HTTPS 暴露时置 true）
    this.cookieSecure = /^(1|true)$/i.test(
      process.env.SESSION_COOKIE_SECURE ?? "",
    );
  }


  /** token 仅以 sha256 摘要入库；原 token 只经 HttpOnly Cookie 传输 */
  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /** 同 IP 连续失败达阈值后的剩余封禁秒数；未封禁返回 0 */
  blockedSeconds(ip: string, now = Date.now()): number {
    const state = this.failures.get(ip);
    if (!state?.blockedUntil) return 0;
    if (state.blockedUntil <= now) {
      this.failures.delete(ip);
      return 0;
    }
    return Math.ceil((state.blockedUntil - now) / 1000);
  }

  /** 记录一次失败；达阈值则封禁该 IP（窗口外自动重新计数） */
  recordFailure(ip: string, now = Date.now()): void {
    const state = this.failures.get(ip);
    if (!state || now - state.firstAt > this.failureWindowMs) {
      if (this.failures.size >= MAX_FAILURE_ENTRIES) {
        this.sweepFailures(now);
      }
      this.failures.set(ip, { count: 1, firstAt: now });
      return;
    }
    state.count += 1;
    if (state.count >= this.maxFailures) {
      state.blockedUntil = now + this.blockMs;
      this.logger.warn(
        createLogMessage("Login temporarily blocked for IP", {
          ip,
          failures: state.count,
          blockMinutes: Math.round(this.blockMs / 60_000),
        }),
      );
    }
  }

  /** 清掉窗口已过且未处于封禁的条目；仍全满时整表丢弃（宁可重新计数，不占用无界内存） */
  private sweepFailures(now: number): void {
    for (const [ip, state] of this.failures) {
      const expired = now - state.firstAt > this.failureWindowMs;
      const blocked = (state.blockedUntil ?? 0) > now;
      if (expired && !blocked) {
        this.failures.delete(ip);
      }
    }
    if (this.failures.size >= MAX_FAILURE_ENTRIES) {
      this.failures.clear();
    }
  }


  resetFailures(ip: string): void {
    this.failures.delete(ip);
  }

  async login(
    username: string,
    password: string,
    ip: string,
  ): Promise<LoginOutcome> {
    const retryAfterSeconds = this.blockedSeconds(ip);
    if (retryAfterSeconds > 0) {
      return { ok: false, reason: "locked", retryAfterSeconds };
    }

    const user = username ? await this.db.findUserByUsername(username) : undefined;
    // 用户不存在也做一次等价开销的校验，避免用户名枚举的时序差异
    const passwordOk = await verifyPassword(
      password.length > MAX_PASSWORD_LENGTH ? "" : password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user?.id || user.disabledAt || !passwordOk) {
      this.recordFailure(ip);
      return { ok: false, reason: "invalid" };
    }

    this.resetFailures(ip);
    await this.db.purgeExpiredUserSessions();

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    await this.db.createUserSession({
      userId: user.id,
      tokenHash: this.hashToken(token),
      expiresAt,
    });
    this.logger.log(
      createLogMessage("User logged in", {
        userId: user.id,
        username: user.username,
        role: user.role,
      }),
    );
    return {
      ok: true,
      result: {
        token,
        expiresAt,
        user: { id: user.id, username: user.username, role: user.role },
      },
    };
  }

  /** 吊销当前会话（登出）；未知 token 视为已登出 */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.deleteUserSessionByTokenHash(this.hashToken(token));
  }

  /**
   * 由 token 解析当前用户；以下均视为未登录：
   * 无 token / 会话不存在 / 会话过期 / 用户不存在 / 用户已禁用。
   */
  async resolveUser(token: string | undefined): Promise<AuthUser | undefined> {
    if (!token) return undefined;
    const tokenHash = this.hashToken(token);
    const session = await this.db.findUserSessionByTokenHash(tokenHash);
    if (!session) return undefined;
    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await this.db.deleteUserSessionByTokenHash(tokenHash);
      await this.db.purgeExpiredUserSessions();
      return undefined;
    }

    const user = await this.db.findUserById(session.userId);
    if (!user?.id || user.disabledAt) return undefined;
    return { id: user.id, username: user.username, role: user.role };
  }

  /** Cookie 选项：HttpOnly + SameSite=Lax + `SESSION_COOKIE_SECURE` 时 Secure */
  cookieOptions(): {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure,
      path: "/",
      maxAge: this.sessionTtlMs,
    };
  }

}
