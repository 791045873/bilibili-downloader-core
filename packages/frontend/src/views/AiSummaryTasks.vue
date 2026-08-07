<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AiSummaryTaskEntry } from "../types";
import { getAiSummaryTasks } from "../api";

const loading = ref(true);
const refreshing = ref(false);
const error = ref("");
const tasks = ref<AiSummaryTaskEntry[]>([]);

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待总结";
    case "analyzing":
      return "总结中";
    case "failed":
      return "总结失败";
    case "completed":
      return "总结完成";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-600";
    case "analyzing":
      return "bg-blue-600";
    case "failed":
      return "bg-red-600";
    case "completed":
      return "bg-emerald-600";
    default:
      return "bg-zinc-500";
  }
}

async function loadTasks() {
  error.value = "";
  try {
    tasks.value = await getAiSummaryTasks();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "加载 AI 总结任务失败";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function refreshTasks() {
  refreshing.value = true;
  await loadTasks();
}

onMounted(async () => {
  await loadTasks();
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-zinc-900">AI 总结任务</h1>
        <p class="mt-1 text-sm text-zinc-600">仅在点击按钮时刷新当前任务状态，不做自动刷新。</p>
      </div>
      <button
        class="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-500"
        :disabled="refreshing"
        @click="refreshTasks"
      >
        {{ refreshing ? "刷新中..." : "刷新任务状态" }}
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
      {{ error }}
    </div>

    <div v-if="!loading && tasks.length === 0" class="rounded-lg border border-zinc-200 bg-white p-12 text-center text-zinc-500">
      暂无 AI 总结任务
    </div>

    <div v-if="tasks.length > 0" class="space-y-3">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-white"
                :class="statusClass(task.status)"
              >
                {{ statusLabel(task.status) }}
              </span>
              <span class="truncate text-sm text-zinc-800">{{ task.title || `${task.bvid}-${task.cid}` }}</span>
            </div>
            <div class="mt-2 text-xs text-zinc-500">
              资源：{{ task.bvid }} / {{ task.cid }}
            </div>
            <div v-if="task.summaryOutput" class="mt-2 text-xs text-zinc-500 break-all">
              总结输出：<span class="text-zinc-700">{{ task.summaryOutput }}</span>
            </div>
            <div v-if="task.status === 'failed' && task.errorMessage" class="mt-2 text-xs text-red-600 break-all">
              错误：{{ task.errorMessage }}
            </div>
            <div v-if="task.updatedAt" class="mt-2 text-xs text-zinc-400">
              更新时间：{{ task.updatedAt }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>