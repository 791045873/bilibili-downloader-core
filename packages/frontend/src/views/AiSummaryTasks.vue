<script setup lang="ts">
import { onMounted, ref } from "vue";
import Dialog from "primevue/dialog";
import type { AiSummaryTaskEntry } from "../types";
import {
  deleteAiSummaryTask,
  getAiSummaryTaskRawResponse,
  getAiSummaryTasks,
  retriggerAiSummaryTask,
} from "../api";

const loading = ref(true);
const refreshing = ref(false);
const deleting = ref(false);
const retriggering = ref(false);
const error = ref("");
const tasks = ref<AiSummaryTaskEntry[]>([]);

const rawDialogVisible = ref(false);
const rawDialogLoading = ref(false);
const rawDialogTitle = ref("");
const rawDialogContent = ref("");
const rawDialogError = ref("");
const rawDialogIsFallbackError = ref(false);

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

function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function summaryTime(task: AiSummaryTaskEntry): string {
  if (task.status === "completed" || task.status === "failed") {
    return formatTime(task.lastCompletedAt);
  }
  return "—";
}

function formatMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${seconds}秒`;
}

function derivedTotalMs(task: AiSummaryTaskEntry): number | undefined {
  if (!task.lastCompletedAt || !task.lastTriggeredAt) return undefined;
  const end = new Date(task.lastCompletedAt).getTime();
  const start = new Date(task.lastTriggeredAt).getTime();
  if (Number.isNaN(end) || Number.isNaN(start) || end <= 0 || start <= 0) {
    return undefined;
  }
  if (end < start) return undefined;
  return end - start;
}

function timingLine(task: AiSummaryTaskEntry): string {
  const t = task.executionTiming;
  const parts: string[] = [];
  if (t) {
    if (t.llmMs > 0) parts.push(`LLM ${formatMs(t.llmMs)}`);
    if (t.screenshotMs > 0) parts.push(`截图 ${formatMs(t.screenshotMs)}`);
    if (t.totalMs > 0) parts.push(`总计 ${formatMs(t.totalMs)}`);
  }
  if (parts.length === 0) {
    // 回退：无耗时明细（历史任务/空内容总结）时，用 lastCompletedAt - lastTriggeredAt 推导总计
    const derived = derivedTotalMs(task);
    return derived !== undefined ? `总计 ${formatMs(derived)}` : "";
  }
  return parts.join(" · ");
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

function isInProgress(task: AiSummaryTaskEntry): boolean {
  return task.status === "pending" || task.status === "analyzing";
}

async function handleDelete(task: AiSummaryTaskEntry) {
  deleting.value = true;
  try {
    await deleteAiSummaryTask(task.id);
    await loadTasks();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "删除 AI 总结任务失败";
  } finally {
    deleting.value = false;
  }
}

async function handleRetrigger(task: AiSummaryTaskEntry) {
  retriggering.value = true;
  try {
    await retriggerAiSummaryTask(task.id);
    await loadTasks();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "重新 AI 总结失败";
  } finally {
    retriggering.value = false;
  }
}

async function openRawResponse(task: AiSummaryTaskEntry) {
  rawDialogTitle.value =
    (task.title || `${task.bvid}-${task.cid}`) + " - 原始返回";
  rawDialogContent.value = "";
  rawDialogError.value = "";
  rawDialogIsFallbackError.value = false;
  rawDialogVisible.value = true;
  rawDialogLoading.value = true;
  try {
    const result = await getAiSummaryTaskRawResponse(task.id);
    if (result.rawResponse) {
      rawDialogContent.value = result.rawResponse;
    } else if (task.errorMessage) {
      rawDialogContent.value = task.errorMessage;
      rawDialogIsFallbackError.value = true;
    } else {
      rawDialogContent.value = "";
    }
  } catch (e: unknown) {
    rawDialogError.value = e instanceof Error ? e.message : "获取原始返回失败";
  } finally {
    rawDialogLoading.value = false;
  }
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

    <div v-if="tasks.length > 0" class="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table class="w-full min-w-[900px] text-sm">
        <thead>
          <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <th class="px-4 py-3 font-medium">视频标题</th>
            <th class="px-4 py-3 font-medium">状态</th>
            <th class="px-4 py-3 font-medium">模型</th>
            <th class="px-4 py-3 font-medium">总结时间</th>
            <th class="px-4 py-3 font-medium">执行耗时</th>
            <th class="px-4 py-3 font-medium">总结输出</th>
            <th class="px-4 py-3 font-medium">更新时间</th>
            <th class="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="task in tasks"
            :key="task.id"
            class="border-b border-zinc-100 align-top last:border-b-0 hover:bg-zinc-50"
          >
            <td class="px-4 py-3">
              <div class="max-w-[260px] truncate font-medium text-zinc-900" :title="task.title || ''">
                {{ task.title || `${task.bvid}-${task.cid}` }}
              </div>
              <div class="mt-0.5 text-xs text-zinc-500">
                {{ task.bvid }} / {{ task.cid }}
              </div>
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-white"
                :class="statusClass(task.status)"
              >
                {{ statusLabel(task.status) }}
              </span>
              <div v-if="task.status === 'failed' && task.errorMessage" class="mt-1 max-w-[240px] break-all text-xs text-red-600">
                {{ task.errorMessage }}
              </div>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-zinc-700">
              <span v-if="task.modelName" :title="task.modelName">{{ task.modelName }}</span>
              <span v-else class="text-zinc-400">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-zinc-700">
              {{ summaryTime(task) }}
            </td>
            <td class="px-4 py-3">
              <span v-if="timingLine(task)" class="text-xs text-zinc-700">{{ timingLine(task) }}</span>
              <span v-else class="text-zinc-400">—</span>
            </td>
            <td class="px-4 py-3">
              <span v-if="task.summaryOutput" class="max-w-[260px] break-all text-xs text-zinc-500" :title="task.summaryOutput">
                {{ task.summaryOutput }}
              </span>
              <span v-else class="text-zinc-400">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-zinc-400">
              {{ formatTime(task.updatedAt) }}
            </td>
            <td class="whitespace-nowrap px-4 py-3">
              <div class="flex items-center gap-2">
                <button
                  class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-800"
                  @click="openRawResponse(task)"
                >
                  查看原始
                </button>
                <button
                  class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:text-zinc-400"
                  :class="isInProgress(task)
                    ? ''
                    : 'text-emerald-600 hover:border-emerald-400 hover:text-emerald-500'"
                  :disabled="isInProgress(task) || retriggering"
                  @click="handleRetrigger(task)"
                >
                  重新总结
                </button>
                <button
                  class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:text-zinc-400"
                  :class="isInProgress(task)
                    ? ''
                    : 'text-red-600 hover:border-red-400 hover:text-red-500'"
                  :disabled="isInProgress(task) || deleting"
                  @click="handleDelete(task)"
                >
                  {{ isInProgress(task) ? "进行中" : "删除" }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog
      v-model:visible="rawDialogVisible"
      :header="rawDialogTitle"
      :modal="true"
      :closable="true"
      :style="{ width: '720px' }"
    >
      <div v-if="rawDialogLoading" class="py-6 text-center text-sm text-zinc-500">
        加载中...
      </div>
      <div v-else-if="rawDialogError" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
        {{ rawDialogError }}
      </div>
      <pre
        v-if="rawDialogContent"
        class="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800"
      >{{ rawDialogContent }}</pre>
      <p v-if="rawDialogIsFallbackError" class="mt-2 text-xs text-red-500">
        本次无模型原始返回，以上为记录中的错误信息
      </p>
      <div v-if="!rawDialogContent && !rawDialogIsFallbackError" class="py-6 text-center text-sm text-zinc-400">
        无原始返回（历史记录或本次未成功返回模型内容）
      </div>
    </Dialog>
  </div>
</template>
