import { Module } from "@nestjs/common";
import { UserSeedService } from "./user-seed.service.js";

/**
 * 用户系统与写操作鉴权（auth）。
 * 注：既有 `src/auth/auth.controller.ts` 是 B站扫码登录，与本模块关注点不同。
 */
@Module({
  providers: [UserSeedService],
  exports: [UserSeedService],
})
export class UserAuthModule {}
