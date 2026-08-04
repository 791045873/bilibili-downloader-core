<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import type { TaskEntry, TaskStatusGroup } from "../types";
import ProgressBar from "primevue/progressbar";
import * as api from "../api";

const router = useRouter();
const actionError = ref("");
const loading = ref(true);
const refreshing = ref(false);
const tasks = ref<TaskEntry[]>([]);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const hasMore = ref(false);
const statusGroup = ref<TaskStatusGroup>("all");

// 每个活跃任务独立的轮询 timer
const pollTimers = new Map<number, ReturnType<typeof setInterval>>();

const activeTasks = computed(() =>
  tasks.value.filter(
    (t): boolean => t.status !== "success" && t.status !== "failed",
  ),
);

const successCount = computed(
  () => tasks.value.filter((t) => t.status === "success").length,
);

const failedCount = computed(
  () => tasks.value.filter((t) => t.status === "failed").length,
);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);

onMounted(() => {
  void loadTasks();
});

onUnmounted(() => {
  stopAllPolls();
});

// ==================== 数据与轮询 ====================

function stopAllPolls() {
  pollTimers.forEach((timer) => clearInterval(timer));
  pollTimers.clear();
}

function syncCurrentPagePolls() {
  stopAllPolls();
  for (const task of tasks.value) {
    if (task.status === "success" || task.status === "failed") {
      continue;
    }
    pollTimers.set(
      task.id,
      setInterval(() => {
        void refreshTask(task.id);
      }, 3000),
    );
  }
}

async function loadTasks() {
  loading.value = true;
  actionError.value = "";
  try {
    const result = await api.getTasks({
      page: page.value,
      pageSize: pageSize.value,
      statusGroup: statusGroup.value,
    });
    tasks.value = result.items;
    total.value = result.total;
    hasMore.value = result.hasMore;
    syncCurrentPagePolls();
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : "加载任务列表失败";
    tasks.value = [];
    total.value = 0;
    hasMore.value = false;
    stopAllPolls();
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function refreshTask(id: number) {
  try {
    const task = await api.getTaskById(id);
    const index = tasks.value.findIndex((item) => item.id === id);
    if (index === -1) {
      const timer = pollTimers.get(id);
      if (timer) {
        clearInterval(timer);
        pollTimers.delete(id);
      }
      return;
    }
    tasks.value[index] = task;
    if (task.status === "success" || task.status === "failed") {
      const timer = pollTimers.get(id);
      if (timer) {
        clearInterval(timer);
        pollTimers.delete(id);
      }
    }
  } catch {
    const timer = pollTimers.get(id);
    if (timer) {
      clearInterval(timer);
      pollTimers.delete(id);
    }
  }
}

function summaryStatusLabel(summaryStatus?: string): string {
  switch (summaryStatus) {
    case "pending":
      return "待总结";
    case "analyzing":
      return "总结中";
    case "failed":
      return "总结失败";
    case "completed":
      return "总结完成";
    default:
      return "未总结";
  }
}

function isSummaryRunning(summaryStatus?: string): boolean {
  return summaryStatus === "pending" || summaryStatus === "analyzing";
}

function canTriggerAiSummary(task: TaskEntry): boolean {
  return task.status === "success" && !isSummaryRunning(task.summaryStatus);
}

function aiSummaryButtonLabel(task: TaskEntry): string {
  if (isSummaryRunning(task.summaryStatus)) {
    return "AI 总结中";
  }
  if (task.summaryStatus && task.summaryStatus !== "none") {
    return "重新 AI 总结";
  }
  return "立刻 AI 总结";
}

async function handleTriggerAiSummary(id: number) {
  actionError.value = "";
  const existing = tasks.value.find((task) => task.id === id);
  if (!existing || !canTriggerAiSummary(existing)) {
    return;
  }

  try {
    await api.triggerTaskAiSummary(id);
    const index = tasks.value.findIndex((task) => task.id === id);
    if (index !== -1) {
      tasks.value[index] = {
        ...existing,
        summaryStatus: "pending",
      };
    }
    await refreshTask(id);
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : "触发 AI 总结失败";
  }
}

// ==================== 操作 ====================

async function handleDelete(id: number) {
  await api.deleteTask(id);
  const timer = pollTimers.get(id);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(id);
  }
  if (tasks.value.length === 1 && page.value > 1) {
    page.value -= 1;
  }
  await loadTasks();
}

async function handleStop(id: number) {
  await api.stopTask(id);
  await refreshTask(id);
}

async function handleResume(id: number) {
  await api.resumeTask(id);
  await refreshTask(id);
}

async function handleRefresh() {
  refreshing.value = true;
  await loadTasks();
}

async function handleStatusGroupChange(next: TaskStatusGroup) {
  if (statusGroup.value === next) {
    return;
  }
  statusGroup.value = next;
  page.value = 1;
  await loadTasks();
}

async function handlePageChange(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) {
    return;
  }
  page.value = nextPage;
  await loadTasks();
}

async function handlePageSizeChange(nextSize: number) {
  if (nextSize === pageSize.value) {
    return;
  }
  pageSize.value = nextSize;
  page.value = 1;
  await loadTasks();
}

// ==================== 展示 ====================

function statusLabel(status: string): string {
  switch (status) {
    case "downloading": return "下载中";
    case "success": return "已完成";
    case "failed": return "失败";
    case "created": return "排队中";
    case "stopped": return "已停止";
    default: return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "downloading": return "bg-blue-600";
    case "success": return "bg-emerald-600";
    case "failed": return "bg-red-600";
    case "created": return "bg-amber-600";
    case "stopped": return "bg-zinc-600";
    default: return "bg-zinc-700";
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="actionError" class="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      {{ actionError }}
    </div>

    <!-- 统计 -->
    <div class="grid grid-cols-3 gap-4">
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
        <div class="text-2xl font-bold text-blue-400">{{ activeTasks.length }}</div>
        <div class="text-sm text-zinc-500 mt-1">进行中</div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
        <div class="text-2xl font-bold text-emerald-400">{{ successCount }}</div>
        <div class="text-sm text-zinc-500 mt-1">已完成</div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
        <div class="text-2xl font-bold text-red-400">{{ failedCount }}</div>
        <div class="text-sm text-zinc-500 mt-1">失败</div>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="flex flex-wrap items-center gap-2">
      <select
        class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        :value="statusGroup"
        @change="handleStatusGroupChange(($event.target as HTMLSelectElement).value as TaskStatusGroup)"
      >
        <option value="all">全部任务</option>
        <option value="active">进行中</option>
        <option value="created">排队中</option>
        <option value="downloading">下载中</option>
        <option value="success">已完成</option>
        <option value="failed">失败</option>
        <option value="stopped">已停止</option>
      </select>
      <button
        class="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors disabled:cursor-not-allowed disabled:text-zinc-500"
        :disabled="refreshing"
        @click="handleRefresh"
      >
        {{ refreshing ? "刷新中..." : "刷新当前页" }}
      </button>
      <div class="ml-auto flex items-center gap-2 text-sm text-zinc-500">
        <span>每页</span>
        <select
          class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
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

    <!-- 空状态 -->
    <div v-if="!loading && tasks.length === 0" class="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
      <p class="text-zinc-500 mb-4">暂无下载任务</p>
      <button
        class="rounded-md bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-500 transition-colors"
        @click="router.push('/')"
      >
        去添加任务
      </button>
    </div>

    <!-- 任务列表 -->
    <div class="space-y-3" v-if="tasks.length > 0">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white"
                :class="statusClass(task.status)"
              >
                {{ statusLabel(task.status) }}
              </span>
              <span class="text-sm text-zinc-200 truncate">{{ task.title || "(无标题)" }}</span>
            </div>
            <div v-if="task.outputFile" class="mt-2 text-xs text-zinc-500">
              <span class="text-zinc-600">输出文件：</span>
              <code class="break-all text-zinc-400">{{ task.outputFile }}</code>
            </div>
            <div v-if="task.status === 'success'" class="mt-2 text-xs text-zinc-500">
              <span class="text-zinc-600">AI 总结：</span>
              <span class="text-zinc-300">{{ summaryStatusLabel(task.summaryStatus) }}</span>
            </div>
            <div v-if="task.status === 'downloading'" class="mt-2">
              <ProgressBar :value="task.progress ?? 0" />
            </div>
            <div v-if="task.status === 'success' && task.fileSize" class="text-xs text-zinc-500 mt-1">
              {{ formatBytes(task.fileSize) }}
            </div>
            <div v-if="task.status === 'failed' && task.errorMessage" class="text-xs text-red-400 mt-1">
              {{ task.errorMessage }}
            </div>
          </div>
          <!-- Created → 暂停 -->
          <button
            v-if="task.status === 'created'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:border-amber-800 transition-colors"
            @click="handleStop(task.id)"
          >
            暂停
          </button>
          <!-- Stopped → 恢复 -->
          <button
            v-if="task.status === 'stopped'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:border-emerald-800 transition-colors"
            @click="handleResume(task.id)"
          >
            恢复
          </button>
          <!-- Downloading → 取消 -->
          <button
            v-if="task.status === 'downloading'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-red-400 hover:border-red-800 transition-colors"
            @click="handleDelete(task.id)"
          >
            取消
          </button>
          <button
            v-if="task.status === 'success'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs transition-colors"
            :class="canTriggerAiSummary(task)
              ? 'text-rose-300 hover:text-rose-200 hover:border-rose-700'
              : 'cursor-not-allowed text-zinc-500'"
            :disabled="!canTriggerAiSummary(task)"
            @click="handleTriggerAiSummary(task.id)"
          >
            {{ aiSummaryButtonLabel(task) }}
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <button
            class="rounded-md border border-zinc-700 px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:text-zinc-600"
            :disabled="page <= 1"
            @click="handlePageChange(page - 1)"
          >
            上一页
          </button>
          <button
            class="rounded-md border border-zinc-700 px-3 py-1.5 transition-colors disabled:cursor-not-allowed disabled:text-zinc-600"
            :disabled="!hasMore"
            @click="handlePageChange(page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>