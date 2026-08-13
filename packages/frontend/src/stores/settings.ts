import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppSettings } from "../types";

const STORAGE_KEY = "bilibili-downloader-settings";

const DEFAULT_SETTINGS: AppSettings = {
  autoParse: false,
  autoDownload: false,
  defaultQuality: 80,
  defaultCodec: "",
  defaultAudioQuality: "192K",
  downloadDanmaku: false,
  downloadSubtitle: false,
  defaultFileNameTemplate: "",
};

interface SettingsState {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}

// 旧版（Pinia）直接存储裸 AppSettings 对象；zustand persist 存储 {state, version} 信封。
// 模块加载时把旧格式一次性转写为信封，避免既有用户设置被静默重置。
function migrateLegacyStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !("state" in (parsed as Record<string, unknown>))
    ) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { settings: parsed }, version: 0 }),
      );
    }
  } catch {
    // ignore
  }
}

migrateLegacyStorage();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ settings: state.settings }),
      // 默认 merge 是顶层替换，会让 settings 丢失存储中不存在的默认字段
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SettingsState> | null;
        return {
          ...currentState,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings ?? {}),
          },
        };
      },
    },
  ),
);
