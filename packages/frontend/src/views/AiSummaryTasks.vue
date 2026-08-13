<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Dialog from "primevue/dialog";
import type { AiSummaryTaskEntry, AiSummaryTaskStatus } from "../types";
import {
  deleteAiSummaryTask,
  getAiSummaryTaskRawResponse,
  getAiSummaryTasks,
  rebuildAiSummaryTask,
  retriggerAiSummaryTask,
} from "../api";

const loading = ref(true);
const refreshing = ref(false);
const deleting = ref(false);
const retriggering = ref(false);
const error = ref("");
const tasks = ref<AiSummaryTaskEntry[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const hasMore = ref(false);
const statusFilter = ref<AiSummaryTaskStatus>("all");
const searchInput = ref("");
const updatedFrom = ref("");
const updatedTo = ref("");

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);

const hasActiveFilter = computed(
  () =>
    statusFilter.value !== "all" ||
    searchInput.value.trim() !== "" ||
    updatedFrom.value !== "" ||
    updatedTo.value !== "",
);

const rawDialogVisible = ref(false);
const rawDialogLoading = ref(false);
const rawDialogTitle = ref("");
const rawDialogContent = ref("");
const rawDialogError = ref("");
const rawDialogIsFallbackError = ref(false);
const rawDialogTask = ref<AiSummaryTaskEntry | null>(null);
const rebuilding = ref(false);
const rebuildMessage = ref("");

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "analyzing":
      return "处理中";
    case "failed":
      return "失败";
    case "completed":
      return "完成";
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
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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

function timingRows(task: AiSummaryTaskEntry): string[] {
  const t = task.executionTiming;
  if (t) {
    const rows: string[] = [];
    if (t.screenshotMs > 0) rows.push(`截图 ${formatMs(t.screenshotMs)}`);
    if (t.totalMs > 0) rows.push(`总计 ${formatMs(t.totalMs)}`);
    if (rows.length > 0) return rows;
  }
  // 回退：无耗时明细（历史任务/空内容总结）时，用 lastCompletedAt - lastTriggeredAt 推导总计
  const derived = derivedTotalMs(task);
  return derived !== undefined ? [`总计 ${formatMs(derived)}`] : [];
}

function toIsoStart(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toIsoEnd(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function loadTasks() {
  error.value = "";
  try {
    const result = await getAiSummaryTasks({
      page: page.value,
      pageSize: pageSize.value,
      status: statusFilter.value,
      search: searchInput.value.trim() || undefined,
      updatedFrom: toIsoStart(updatedFrom.value),
      updatedTo: toIsoEnd(updatedTo.value),
    });
    tasks.value = result.items;
    total.value = result.total;
    hasMore.value = result.hasMore;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "加载 AI 总结任务失败";
    tasks.value = [];
    total.value = 0;
    hasMore.value = false;
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function refreshTasks() {
  refreshing.value = true;
  await loadTasks();
}

function applyFilters() {
  page.value = 1;
  void loadTasks();
}

function handleStatusChange(next: AiSummaryTaskStatus) {
  if (statusFilter.value === next) return;
  statusFilter.value = next;
  applyFilters();
}

function handleSearchSubmit() {
  applyFilters();
}

function handleSearchClear() {
  if (!searchInput.value) return;
  searchInput.value = "";
  applyFilters();
}

function handleDateChange() {
  applyFilters();
}

function handlePageChange(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return;
  page.value = next;
  void loadTasks();
}

function handlePageSizeChange(next: number) {
  if (next === pageSize.value) return;
  pageSize.value = next;
  page.value = 1;
  void loadTasks();
}

function isInProgress(task: AiSummaryTaskEntry): boolean {
  return task.status === "pending" || task.status === "analyzing";
}

async function handleDelete(task: AiSummaryTaskEntry) {
  deleting.value = true;
  try {
    await deleteAiSummaryTask(task.id);
    if (tasks.value.length === 1 && page.value > 1) {
      page.value -= 1;
    }
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
  rawDialogTask.value = task;
  rawDialogTitle.value =
    (task.title || `${task.bvid}-${task.cid}`) + " - 原始返回";
  rawDialogContent.value = "";
  rawDialogError.value = "";
  rawDialogIsFallbackError.value = false;
  rebuildMessage.value = "";
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

async function handleRebuildFromRaw() {
  const task = rawDialogTask.value;
  if (!task) return;
  rebuilding.value = true;
  rebuildMessage.value = "";
  rawDialogError.value = "";
  try {
    await rebuildAiSummaryTask(task.id);
    rebuildMessage.value = "已开始重新构建总结，请刷新任务状态后查看结果";
    await loadTasks();
  } catch (e: unknown) {
    rawDialogError.value = e instanceof Error ? e.message : "重新构建总结失败";
  } finally {
    rebuilding.value = false;
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

    <div class="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <label class="text-sm text-zinc-500">状态</label>
      <select
        class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
        :value="statusFilter"
        @change="handleStatusChange(($event.target as HTMLSelectElement).value as AiSummaryTaskStatus)"
      >
        <option value="all">全部</option>
        <option value="pending">待处理</option>
        <option value="analyzing">处理中</option>
        <option value="completed">完成</option>
        <option value="failed">失败</option>
      </select>

      <label class="ml-2 text-sm text-zinc-500">标题</label>
      <input
        v-model="searchInput"
        type="text"
        placeholder="按视频标题搜索"
        class="w-48 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
        @keyup.enter="handleSearchSubmit"
      />
      <button
        class="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
        @click="handleSearchSubmit"
      >
        搜索
      </button>
      <button
        v-if="searchInput"
        class="rounded-md border border-zinc-300 px-2 py-2 text-sm text-zinc-500 hover:bg-zinc-100"
        @click="handleSearchClear"
      >
        清除
      </button>

      <label class="ml-2 text-sm text-zinc-500">更新自</label>
      <input
        v-model="updatedFrom"
        type="date"
        class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
        @change="handleDateChange"
      />
      <label class="text-sm text-zinc-500">至</label>
      <input
        v-model="updatedTo"
        type="date"
        class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800"
        @change="handleDateChange"
      />

      <div class="ml-auto flex items-center gap-2 text-sm text-zinc-500">
        <span>每页</span>
        <select
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800"
          :value="pageSize"
          @change="handlePageSizeChange(Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
        <span>条，共 {{ total }} 条</span>
      </div>
    </div>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
      {{ error }}
    </div>

    <div v-if="!loading && tasks.length === 0" class="rounded-lg border border-zinc-200 bg-white p-12 text-center text-zinc-500">
      {{ hasActiveFilter ? "无匹配的 AI 总结任务" : "暂无 AI 总结任务" }}
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
            <td class="px-4 py-3">
              <span
                v-if="task.modelName"
                class="block max-w-[80px] truncate text-zinc-700"
                :title="task.modelName"
              >{{ task.modelName }}</span>
              <span v-else class="text-zinc-400">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-zinc-700">
              {{ summaryTime(task) }}
            </td>
            <td class="px-4 py-3">
              <div v-if="timingRows(task).length > 0" class="space-y-0.5 text-xs text-zinc-700">
                <div v-for="row in timingRows(task)" :key="row">{{ row }}</div>
              </div>
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

    <div v-if="tasks.length > 0" class="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
      <span>第 {{ page }} / {{ totalPages }} 页</span>
      <div class="flex gap-2">
        <button
          class="rounded-md border border-zinc-300 px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:text-zinc-300"
          :disabled="page <= 1"
          @click="handlePageChange(page - 1)"
        >
          上一页
        </button>
        <button
          class="rounded-md border border-zinc-300 px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:text-zinc-300"
          :disabled="!hasMore"
          @click="handlePageChange(page + 1)"
        >
          下一页
        </button>
      </div>
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
      <div
        v-if="rawDialogTask && rawDialogTask.status === 'completed'"
        class="mt-4 flex items-center gap-3 border-t border-zinc-200 pt-4"
      >
        <button
          class="rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:text-zinc-400"
          :class="rebuilding
            ? ''
            : 'text-emerald-600 hover:border-emerald-400 hover:text-emerald-500'"
          :disabled="rebuilding"
          @click="handleRebuildFromRaw"
        >
          {{ rebuilding ? "重新构建中..." : "重新构建总结" }}
        </button>
        <span v-if="rebuildMessage" class="text-sm text-emerald-600">
          {{ rebuildMessage }}
        </span>
      </div>
    </Dialog>
  </div>
</template>
