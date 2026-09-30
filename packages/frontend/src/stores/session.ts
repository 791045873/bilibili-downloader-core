import { create } from "zustand";
import type { AppUser } from "../types";
import * as api from "../api";
import { UNAUTHORIZED_EVENT } from "../api";

export type SessionStatus = "unknown" | "authenticated" | "anonymous";

interface SessionState {
  user: AppUser | null;
  status: SessionStatus;
  /** 启动/会话变更后拉取当前用户 */
  fetchMe: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 收到 401 广播：本地置为未登录 */
  markAnonymous: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: "unknown",

  async fetchMe() {
    try {
      const { user } = await api.appMe();
      set({ user, status: "authenticated" });
    } catch {
      set({ user: null, status: "anonymous" });
    }
  },

  async login(username: string, password: string) {
    const { user } = await api.appLogin(username, password);
    set({ user, status: "authenticated" });
  },

  async logout() {
    try {
      await api.appLogout();
    } finally {
      set({ user: null, status: "anonymous" });
    }
  },

  markAnonymous() {
    set({ user: null, status: "anonymous" });
  },
}));

// 任一请求返回 401 → 本地会话置空（App 据此跳转登录页）
if (typeof window !== "undefined") {
  window.addEventListener(UNAUTHORIZED_EVENT, () => {
    useSessionStore.getState().markAnonymous();
  });
}

export function isAdmin(user: AppUser | null): boolean {
  return user?.role === "admin";
}
