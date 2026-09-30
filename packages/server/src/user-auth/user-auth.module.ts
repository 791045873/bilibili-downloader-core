import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./auth.guard.js";
import { UserAuthController } from "./user-auth.controller.js";
import { UserSeedService } from "./user-seed.service.js";

/**
 * 用户系统与写操作鉴权（auth）。全局守卫默认拒绝：未登录 401、非 admin 403，
 * 仅 `@Public()` / `@Roles(...)` 显式放开。
 * 注：既有 `src/auth/auth.controller.ts` 是 B站扫码登录，与本模块关注点不同。
 */
@Module({
  controllers: [UserAuthController],
  providers: [
    AuthService,
    UserSeedService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, UserSeedService],
})
export class UserAuthModule {}
