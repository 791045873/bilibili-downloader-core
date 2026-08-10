import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettings } from "../types";

const STORAGE_KEY = "bilibili-downloader-settings";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>({
    autoParse: false,
    autoDownload: false,
    defaultQuality: 80,
    defaultCodec: "",
    defaultAudioQuality: "192K",
    downloadDanmaku: false,
    downloadSubtitle: false,
    defaultFileNameTemplate: "",
  });
  const loaded = ref(false);

  function load() {
    if (loaded.value) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        settings.value = { ...settings.value, ...JSON.parse(stored) };
      }
    } catch {
      /* ignore */
    }
    loaded.value = true;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value));
  }

  return { settings, loaded, load, save };
});