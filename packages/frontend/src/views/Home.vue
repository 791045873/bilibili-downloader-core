<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "../stores/settings";

const router = useRouter();
const settingsStore = useSettingsStore();

const inputText = ref("");

onMounted(() => {
  settingsStore.load();
});

function handleSubmit() {
  const input = inputText.value.trim();
  if (!input) return;
  router.push({ name: "parse-result", query: { input } });
}
</script>

<template>
  <div class="space-y-8">
    <!-- 输入区域 -->
    <div class="rounded-lg border border-zinc-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-rose-600 mb-4">输入 Bilibili 链接</h2>
      <form class="flex gap-3" @submit.prevent="handleSubmit">
        <input
          v-model="inputText"
          type="text"
          placeholder="BV号 / 视频链接 / 用户空间 / 合集 / 收藏夹链接..."
          class="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-rose-500 focus:outline-none"
          autofocus
        />
        <button
          type="submit"
          :disabled="!inputText.trim()"
          class="rounded-md bg-rose-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-rose-500 disabled:bg-zinc-200 disabled:text-zinc-400 transition-colors"
        >
          解析视频
        </button>
      </form>
    </div>

    <!-- 快捷入口 -->
    <div class="grid grid-cols-2 gap-4">
      <button
        class="rounded-lg border border-zinc-200 bg-white p-5 text-left hover:border-rose-500/50 transition-colors"
        @click="router.push('/downloading')"
      >
        <div class="text-2xl mb-2">📥</div>
        <div class="font-medium text-zinc-900">下载队列</div>
        <div class="text-sm text-zinc-500 mt-1">查看/管理下载任务</div>
      </button>
      <button
        class="rounded-lg border border-zinc-200 bg-white p-5 text-left hover:border-rose-500/50 transition-colors"
        @click="router.push('/settings')"
      >
        <div class="text-2xl mb-2">⚙️</div>
        <div class="font-medium text-zinc-900">设置</div>
        <div class="text-sm text-zinc-500 mt-1">默认画质、编码偏好</div>
      </button>
    </div>
  </div>
</template>