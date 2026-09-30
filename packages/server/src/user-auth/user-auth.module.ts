import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { UserAuthController } from "./user-auth.controller.js";
import { UserSeedService } from "./user-seed.service.js";

/**
 * 用户系统与写操作鉴权（auth）。
 * 注：既有 `src/auth/auth.controller.ts` 是 B站扫码登录，与本模块关注点不同。
 */
@Module({
  controllers: [UserAuthController],
  providers: [AuthService, UserSeedService],
  exports: [AuthService, UserSeedService],
})
export class UserAuthModule {}
