import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { UserRecord } from "../database/database.service.js";
import { AuthService } from "./auth.service.js";
import { ROLE_ADMIN, ROLE_USER } from "./auth.constants.js";
import type { AuthUser } from "./auth.constants.js";
import { CurrentUser } from "./auth.decorators.js";
import { hashPassword } from "./password.util.js";

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export interface UserView {
  id: number;
  username: string;
  role: string;
  createdAt?: string;
  disabledAt?: string;
}

/**
 * admin 用户管理（创建 / 列表 / 禁用）。
 * 无 `@Roles` 标注 → 全局守卫默认仅 admin。响应永不含 password_hash。
 */
@Controller("api/users")
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body() body: { username?: string; password?: string; role?: string } = {},
  ): Promise<{ user: UserView }> {
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    const role = (body.role ?? ROLE_USER).trim();

    if (
      username.length < USERNAME_MIN ||
      username.length > USERNAME_MAX ||
      !USERNAME_PATTERN.test(username)
    ) {
      throw new BadRequestException(
        `用户名需为 ${USERNAME_MIN}-${USERNAME_MAX} 位字母、数字或 . _ -`,
      );
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new BadRequestException(`密码长度需为 ${PASSWORD_MIN}-${PASSWORD_MAX} 位`);
    }
    if (role !== ROLE_ADMIN && role !== ROLE_USER) {
      throw new BadRequestException("角色仅支持 admin / user");
    }
    if (await this.db.findUserByUsername(username)) {
      throw new ConflictException("用户名已存在");
    }

    const id = await this.db.createUser({
      username,
      passwordHash: await hashPassword(password),
      role,
    });
    return { user: { id, username, role } };
  }

  @Get()
  async listUsers(): Promise<{ users: UserView[] }> {
    const users = await this.db.listUsers();
    return { users: users.map(toUserView) };
  }

  /** 禁用用户并吊销其全部会话；幂等。禁止禁用自己或最后一个在用 admin（防锁死） */
  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disableUser(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() current: AuthUser,
  ): Promise<{ user: UserView; sessionsRevoked: number }> {
    const target = await this.db.findUserById(id);
    if (!target?.id) {
      throw new NotFoundException("用户不存在");
    }
    if (target.id === current.id) {
      throw new ForbiddenException("不能禁用当前登录的用户");
    }
    if (target.role === ROLE_ADMIN && !target.disabledAt) {
      const activeAdmins = (await this.db.listUsers()).filter(
        (u) => u.role === ROLE_ADMIN && !u.disabledAt,
      );
      if (activeAdmins.length <= 1) {
        throw new ForbiddenException("不能禁用最后一个可用 admin");
      }
    }

    if (!target.disabledAt) {
      await this.db.disableUser(target.id);
    }
    const sessionsRevoked = await this.db.deleteUserSessionsByUserId(target.id);
    const updated = await this.db.findUserById(target.id);
    return {
      user: toUserView(updated ?? target),
      sessionsRevoked,
    };
  }
}

function toUserView(user: UserRecord): UserView {
  return {
    id: user.id!,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
  };
}
