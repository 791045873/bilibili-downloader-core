import { create } from "zustand";
import type { UserInfo } from "../types";
import * as api from "../api";

export const statusText: Record<string, string> = {
  pending: "等待扫码",
  scanned: "已扫码，请确认",
  confirmed: "登录成功",
  expired: "二维码已过期",
};

interface AuthState {
  user: UserInfo | null;
  qrcodeUrl: string;
  qrcodeKey: string;
  loginStatus: string;
  checkLogin: () => Promise<void>;
  startLogin: () => Promise<void>;
  closeQrCode: () => void;
  logout: () => void;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  qrcodeUrl: "",
  qrcodeKey: "",
  loginStatus: "waiting",

  async checkLogin() {
    try {
      const u = await api.getCurrentUser();
      set({ user: u });
    } catch {
      /* ignore */
    }
  },

  async startLogin() {
    try {
      const qr = await api.getQrCode();
      set({
        qrcodeUrl: qr.url,
        qrcodeKey: qr.qrcodeKey,
        loginStatus: "waiting",
      });
      get().startPolling();
    } catch (e) {
      console.error("获取登录二维码失败:", e);
    }
  },

  startPolling() {
    get().stopPolling();
    const poll = async () => {
      try {
        const result = await api.getQrStatus(get().qrcodeKey);
        set({ loginStatus: result.status });
        if (result.status === "confirmed") {
          await get().checkLogin();
          return;
        }
        if (result.status === "expired") {
          return;
        }
      } catch {
        /* ignore */
      }
      pollTimer = setTimeout(poll, 2000);
    };
    void poll();
  },

  stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  },

  closeQrCode() {
    get().stopPolling();
  },

  logout() {
    set({ user: null });
  },
}));
