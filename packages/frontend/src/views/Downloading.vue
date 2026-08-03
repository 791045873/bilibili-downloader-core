<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useDownloadQueueStore } from "../stores/useDownloadQueueStore";
import type { TaskEntry } from "../types";
import ProgressBar from "primevue/progressbar";
import * as api from "../api";

const router = useRouter();
const queueStore = useDownloadQueueStore();
const actionError = ref("");

/** 所有任务状态缓存（key = taskId） */
const taskMap = ref<Map<number, TaskEntry>>(new Map());
const loading = ref(true);

/** 活跃任务（非终态） */
const activeTasks = () =>
  [...taskMap.value.values()].filter(
    (t): boolean => t.status !== "success" && t.status !== "failed",
  );

/** 终态任务 */
const finishedTasks = () =>
  [...taskMap.value.values()].filter(
    (t): boolean => t.status === "success" || t.status === "failed",
  );

const successCount = () =>
  [...taskMap.value.values()].filter((t) => t.status === "success").length;

const failedCount = () =>
  [...taskMap.value.values()].filter((t) => t.status === "failed").length;

// 每个活跃任务独立的轮询 timer
const pollTimers = new Map<number, ReturnType<typeof setInterval>>();

onMounted(() => {
  queueStore.init();
  startAllPolls();
});

onUnmounted(() => {
  stopAllPolls();
});

// ==================== 轮询 ====================

function startAllPolls() {
  loading.value = true;
  console.log('start poll', queueStore.taskIds);
  for (const id of queueStore.taskIds) {
    // 首次拉取
    fetchTask(id);
    // 定期轮询
    pollTimers.set(
      id,
      setInterval(() => fetchTask(id), 3000),
    );
  }
  loading.value = false;
}

function stopAllPolls() {
  pollTimers.forEach((timer) => clearInterval(timer));
  pollTimers.clear();
}

async function fetchTask(id: number) {
  try {
    const task = await api.getTaskById(id);
    taskMap.value.set(id, task);

    // 终态 → 停止轮询
    if (task.status === "success" || task.status === "failed") {
      const timer = pollTimers.get(id);
      if (timer) {
        clearInterval(timer);
        pollTimers.delete(id);
      }
    }
  } catch {
    // 请求失败暂不处理
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
  const existing = taskMap.value.get(id);
  if (!existing || !canTriggerAiSummary(existing)) {
    return;
  }

  try {
    await api.triggerTaskAiSummary(id);
    taskMap.value.set(id, {
      ...existing,
      summaryStatus: "pending",
    });
    taskMap.value = new Map(taskMap.value);
    await fetchTask(id);
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
  queueStore.removeTaskId(id);
  taskMap.value.delete(id);
  // 触发响应式
  taskMap.value = new Map(taskMap.value);
}

async function handleStop(id: number) {
  await api.stopTask(id);
  // 刷新任务状态
  const task = await api.getTaskById(id);
  taskMap.value.set(id, task);
  taskMap.value = new Map(taskMap.value);
}

async function handleResume(id: number) {
  await api.resumeTask(id);
  const task = await api.getTaskById(id);
  taskMap.value.set(id, task);
  taskMap.value = new Map(taskMap.value);
}

function handleClearFinished() {
  const finished = finishedTasks();
  const ids = finished.map((t) => t.id);
  queueStore.clearFinished(ids);
  ids.forEach((id) => taskMap.value.delete(id));
  taskMap.value = new Map(taskMap.value);
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
        <div class="text-2xl font-bold text-blue-400">{{ activeTasks().length }}</div>
        <div class="text-sm text-zinc-500 mt-1">进行中</div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
        <div class="text-2xl font-bold text-emerald-400">{{ successCount() }}</div>
        <div class="text-sm text-zinc-500 mt-1">已完成</div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
        <div class="text-2xl font-bold text-red-400">{{ failedCount() }}</div>
        <div class="text-sm text-zinc-500 mt-1">失败</div>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="flex gap-2" v-if="finishedTasks().length > 0">
      <button
        class="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 transition-colors"
        @click="handleClearFinished"
      >
        清空已完成
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="taskMap.size === 0" class="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
      <p class="text-zinc-500 mb-4">暂无下载任务</p>
      <button
        class="rounded-md bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-500 transition-colors"
        @click="router.push('/')"
      >
        去添加任务
      </button>
    </div>

    <!-- 任务列表 -->
    <div class="space-y-3" v-if="taskMap.size > 0">
      <div
        v-for="[id, task] in taskMap"
        :key="id"
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
            @click="handleStop(id)"
          >
            暂停
          </button>
          <!-- Stopped → 恢复 -->
          <button
            v-if="task.status === 'stopped'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:border-emerald-800 transition-colors"
            @click="handleResume(id)"
          >
            恢复
          </button>
          <!-- Downloading → 取消 -->
          <button
            v-if="task.status === 'downloading'"
            class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-red-400 hover:border-red-800 transition-colors"
            @click="handleDelete(id)"
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
            @click="handleTriggerAiSummary(id)"
          >
            {{ aiSummaryButtonLabel(task) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>