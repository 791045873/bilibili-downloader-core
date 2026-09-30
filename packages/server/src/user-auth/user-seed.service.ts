import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { hashPassword } from "./password.util.js";
import { ADMIN_USERNAME, ROLE_ADMIN } from "./auth.constants.js";

/**
 * 启动引导：幂等播种内置 admin + 存量会话归属回填。
 *
 * - `ADMIN_INITIAL_PASSWORD` 缺失时仅告警，**不创建默认密码**。
 * - admin 已存在则不动（不改密码、不改角色）。
 * - 存量 `conversation.user_id` 为空的行回填归首个 admin；无 admin 时为 no-op。
 */
@Injectable()
export class UserSeedService implements OnModuleInit {
  private readonly logger = new Logger(UserSeedService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdminIfMissing();
    await this.backfillConversationOwnership();
  }

  private async seedAdminIfMissing(): Promise<void> {
    const existing = await this.db.findUserByUsername(ADMIN_USERNAME);
    if (existing) {
      return;
    }
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password) {
      this.logger.warn(
        createLogMessage(
          "ADMIN_INITIAL_PASSWORD is not set; skipping admin seed (no default credential created)",
          { username: ADMIN_USERNAME },
        ),
      );
      return;
    }
    const passwordHash = await hashPassword(password);
    const id = await this.db.createUser({
      username: ADMIN_USERNAME,
      passwordHash,
      role: ROLE_ADMIN,
    });
    this.logger.log(
      createLogMessage("Seeded builtin admin user", {
        userId: id,
        username: ADMIN_USERNAME,
        role: ROLE_ADMIN,
      }),
    );
  }

  private async backfillConversationOwnership(): Promise<void> {
    const admin = await this.db.findFirstAdminUser();
    if (!admin?.id) {
      return;
    }
    const count = await this.db.backfillConversationUserId(admin.id);
    if (count > 0) {
      this.logger.log(
        createLogMessage("Backfilled conversation ownership to admin", {
          userId: admin.id,
          count,
        }),
      );
    }
  }
}
