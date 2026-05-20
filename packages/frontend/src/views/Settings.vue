<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSettingsStore } from "../stores/settings";

const settingsStore = useSettingsStore();
const saved = ref(false);

onMounted(() => settingsStore.load());

async function handleSave() {
  await settingsStore.save();
  saved.value = true;
  setTimeout(() => (saved.value = false), 2000);
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 class="text-lg font-semibold text-rose-400 mb-6">下载设置</h2>

      <!-- 自动操作 -->
      <div class="mb-6">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">自动操作</h3>
        <div class="space-y-3">
          <label class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">自动解析视频</span>
            <input type="checkbox" v-model="settingsStore.settings.autoParse" class="accent-rose-500 w-4 h-4" />
          </label>
          <label class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">解析后自动下载</span>
            <input type="checkbox" v-model="settingsStore.settings.autoDownload" class="accent-rose-500 w-4 h-4" />
          </label>
        </div>
      </div>

      <!-- 画质偏好 -->
      <div class="mb-6">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">默认画质偏好</h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">视频画质</span>
            <select
              v-model.number="settingsStore.settings.defaultQuality"
              class="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-rose-500 focus:outline-none"
            >
              <option :value="120">4K 超清</option>
              <option :value="80">1080P 高清</option>
              <option :value="64">720P 高清</option>
              <option :value="32">480P 清晰</option>
              <option :value="16">360P 流畅</option>
            </select>
          </div>
          <div class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">视频编码</span>
            <select
              v-model="settingsStore.settings.defaultCodec"
              class="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="">自动</option>
              <option value="AVC">AVC (H.264)</option>
              <option value="HEVC">HEVC (H.265)</option>
              <option value="AV1">AV1</option>
            </select>
          </div>
          <div class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">音频质量</span>
            <select
              v-model="settingsStore.settings.defaultAudioQuality"
              class="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-rose-500 focus:outline-none"
            >
              <option value="192K">192K</option>
              <option value="128K">128K</option>
              <option value="64K">64K</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 附加内容 -->
      <div class="mb-6">
        <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">附加内容</h3>
        <div class="space-y-3">
          <label class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">下载弹幕</span>
            <input type="checkbox" v-model="settingsStore.settings.downloadDanmaku" class="accent-rose-500 w-4 h-4" />
          </label>
          <label class="flex items-center justify-between py-2">
            <span class="text-sm text-zinc-300">下载字幕</span>
            <input type="checkbox" v-model="settingsStore.settings.downloadSubtitle" class="accent-rose-500 w-4 h-4" />
          </label>
        </div>
      </div>

      <button
        class="rounded-md bg-rose-600 px-6 py-2 text-sm font-medium text-white hover:bg-rose-500 transition-colors"
        @click="handleSave"
      >
        {{ saved ? "已保存 ✓" : "保存设置" }}
      </button>
    </div>
  </div>
</template>