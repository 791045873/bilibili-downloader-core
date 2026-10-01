/** 用户会话 Cookie 名（与 B站 扫码 cookie 完全无关：后者存服务端文件，非浏览器 cookie） */
export const SESSION_COOKIE_NAME = "bdl_session";

export const ADMIN_USERNAME = "admin";
export const ROLE_ADMIN = "admin";
export const ROLE_USER = "user";

export type UserRole = typeof ROLE_ADMIN | typeof ROLE_USER;

/** 请求上下文中的当前用户（不含任何凭据字段） */
export interface AuthUser {
  id: number;
  username: string;
  role: string;
}
