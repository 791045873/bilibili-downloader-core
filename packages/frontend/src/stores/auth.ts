import { defineStore } from "pinia";
import { ref } from "vue";
import type { UserInfo } from "../types";
import * as api from "../api";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<UserInfo | null>(null);
  const qrcodeUrl = ref("");
  const qrcodeKey = ref("");
  const loginStatus = ref("waiting");

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function checkLogin() {
    try {
      const u = await api.getCurrentUser();
      user.value = u;
    } catch {
      /* ignore */
    }
  }

  async function startLogin() {
    try {
      const qr = await api.getQrCode();
      qrcodeUrl.value = qr.url;
      qrcodeKey.value = qr.qrcodeKey;
      loginStatus.value = "waiting";
      startPolling();
    } catch (e) {
      console.error("获取登录二维码失败:", e);
    }
  }

  function startPolling() {
    stopPolling();
    const poll = async () => {
      try {
        const result = await api.getQrStatus(qrcodeKey.value);
        loginStatus.value = result.status;
        if (result.status === "confirmed") {
          await checkLogin();
          return;
        } else if (result.status === "expired") {
          return;
        }
      } catch {
        /* ignore */
      }
      pollTimer = setTimeout(poll, 2000);
    };
    poll();
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function closeQrCode() {
    stopPolling();
  }

  function logout() {
    user.value = null;
  }

  return {
    user,
    qrcodeUrl,
    qrcodeKey,
    loginStatus,
    checkLogin,
    startLogin,
    closeQrCode,
    logout,
    startPolling,
    stopPolling,
  };
});

export const statusText: Record<string, string> = {
  pending: "等待扫码",
  scanned: "已扫码，请确认",
  confirmed: "登录成功",
  expired: "二维码已过期",
};