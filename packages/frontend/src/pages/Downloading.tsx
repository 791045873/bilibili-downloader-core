import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Progress, Select, Pagination } from "antd";
import * as api from "../api";
import type { TaskEntry, TaskStatusGroup } from "../types";

const statusGroupOptions = [
  { label: "全部任务", value: "all" },
  { label: "进行中", value: "active" },
  { label: "排队中", value: "created" },
  { label: "下载中", value: "downloading" },
  { label: "已完成", value: "success" },
  { label: "失败", value: "failed" },
  { label: "已停止", value: "stopped" },
];

const pageSizeOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
];

function statusLabel(status: string): string {
  switch (status) {
    case "downloading":
      return "下载中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "created":
      return "排队中";
    case "stopped":
      return "已停止";
    default:
      return status;
  }
}

function statusTagClass(status: string): string {
  switch (status) {
    case "downloading":
      return "bg-blue-600";
    case "success":
      return "bg-emerald-600";
    case "failed":
      return "bg-red-600";
    case "created":
      return "bg-amber-600";
    case "stopped":
      return "bg-zinc-500";
    default:
      return "bg-zinc-500";
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function isActiveTask(t: TaskEntry): boolean {
  return t.status !== "success" && t.status !== "failed";
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

function aiSummaryButtonLabel(task: TaskEntry): string {
  if (isSummaryRunning(task.summaryStatus)) return "AI 总结中";
  if (task.summaryStatus && task.summaryStatus !== "none") {
    return "重新 AI 总结";
  }
  return "立刻 AI 总结";
}

interface TaskRowProps {
  task: TaskEntry;
  onStop: (id: number) => void;
  onResume: (id: number) => void;
  onDelete: (id: number) => void;
  onTriggerSummary: (id: number) => void;
}

function TaskRow({
  task: initial,
  onStop,
  onResume,
  onDelete,
  onTriggerSummary,
}: TaskRowProps) {
  // 非终态任务每 3s 轮询一次详情，终态自动停止
  const { data: task } = useQuery({
    queryKey: ["task", initial.id],
    queryFn: () => api.getTaskById(initial.id),
    initialData: initial,
    refetchInterval: (query) => {
      const t = query.state.data;
      if (!t) return false;
      return isActiveTask(t) ? 3000 : false;
    },
  });

  const canTrigger = task.status === "success" && !isSummaryRunning(task.summaryStatus);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${statusTagClass(task.status)}`}
            >
              {statusLabel(task.status)}
            </span>
            <span className="text-sm text-zinc-800 truncate">
              {task.title || "(无标题)"}
            </span>
          </div>
          {task.outputFile && (
            <div className="mt-2 text-xs text-zinc-500">
              <span className="text-zinc-400">输出文件：</span>
              <code className="break-all text-zinc-600">
                {task.outputFile}
              </code>
            </div>
          )}
          {task.status === "success" && (
            <div className="mt-2 text-xs text-zinc-500">
              <span className="text-zinc-400">AI 总结：</span>
              <span className="text-zinc-700">
                {summaryStatusLabel(task.summaryStatus)}
              </span>
            </div>
          )}
          {task.status === "downloading" && (
            <div className="mt-2">
              <Progress percent={task.progress ?? 0} size="small" />
            </div>
          )}
          {task.status === "success" && task.fileSize ? (
            <div className="text-xs text-zinc-500 mt-1">
              {formatBytes(task.fileSize)}
            </div>
          ) : null}
          {task.status === "failed" && task.errorMessage && (
            <div className="text-xs text-red-600 mt-1">
              {task.errorMessage}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {task.status === "created" && (
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-amber-600 hover:text-amber-500 hover:border-amber-500 transition-colors"
              onClick={() => onStop(task.id)}
            >
              暂停
            </button>
          )}
          {task.status === "stopped" && (
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-emerald-600 hover:text-emerald-500 hover:border-emerald-500 transition-colors"
              onClick={() => onResume(task.id)}
            >
              恢复
            </button>
          )}
          {task.status === "downloading" && (
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:text-red-600 hover:border-red-400 transition-colors"
              onClick={() => onDelete(task.id)}
            >
              取消
            </button>
          )}
          {task.status === "success" && (
            <button
              type="button"
              className={`rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors ${
                canTrigger
                  ? "text-rose-600 hover:text-rose-500 hover:border-rose-400"
                  : "cursor-not-allowed text-zinc-500"
              }`}
              disabled={!canTrigger}
              onClick={() => onTriggerSummary(task.id)}
            >
              {aiSummaryButtonLabel(task)}
            </button>
          )}
          {task.status !== "downloading" && (
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-red-600 hover:border-red-400 hover:text-red-500 transition-colors"
              onClick={() => onDelete(task.id)}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusGroup, setStatusGroup] = useState<TaskStatusGroup>("all");
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const listQuery = useQuery({
    queryKey: ["tasks", page, pageSize, statusGroup],
    queryFn: () => api.getTasks({ page, pageSize, statusGroup }),
  });

  const tasks = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const loading = listQuery.isLoading;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCount = tasks.filter(isActiveTask).length;
  const successCount = tasks.filter((t) => t.status === "success").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;

  function refreshTask(id: number) {
    return queryClient.invalidateQueries({ queryKey: ["task", id] });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await listQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete(id: number) {
    setActionError("");
    try {
      await api.deleteTask(id);
      if (tasks.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await listQuery.refetch();
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "删除任务失败");
    }
  }

  async function handleStop(id: number) {
    setActionError("");
    try {
      await api.stopTask(id);
      await refreshTask(id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "暂停任务失败");
    }
  }

  async function handleResume(id: number) {
    setActionError("");
    try {
      await api.resumeTask(id);
      await refreshTask(id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "恢复任务失败");
    }
  }

  async function handleTriggerAiSummary(id: number) {
    setActionError("");
    const existing = tasks.find((t) => t.id === id);
    if (!existing || !(existing.status === "success" && !isSummaryRunning(existing.summaryStatus))) {
      return;
    }
    try {
      await api.triggerTaskAiSummary(id);
      await refreshTask(id);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "触发 AI 总结失败");
    }
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{activeCount}</div>
          <div className="text-sm text-zinc-500 mt-1">进行中</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">
            {successCount}
          </div>
          <div className="text-sm text-zinc-500 mt-1">已完成</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{failedCount}</div>
          <div className="text-sm text-zinc-500 mt-1">失败</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusGroup}
          options={statusGroupOptions}
          onChange={(v) => {
            setStatusGroup(v);
            setPage(1);
          }}
          style={{ width: 140 }}
        />
        <Button
          loading={refreshing}
          disabled={refreshing}
          onClick={() => void handleRefresh()}
        >
          {refreshing ? "刷新中..." : "刷新当前页"}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm text-zinc-500">
          <span>每页</span>
          <Select
            value={pageSize}
            options={pageSizeOptions}
            onChange={(v) => {
              setPageSize(v);
              setPage(1);
            }}
            style={{ width: 80 }}
          />
          <span>条，共 {total} 条</span>
        </div>
      </div>

      {!loading && tasks.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center">
          <p className="text-zinc-500 mb-4">暂无下载任务</p>
          <Button type="primary" onClick={() => navigate("/")}>
            去添加任务
          </Button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onStop={(id) => void handleStop(id)}
              onResume={(id) => void handleResume(id)}
              onDelete={(id) => void handleDelete(id)}
              onTriggerSummary={(id) => void handleTriggerAiSummary(id)}
            />
          ))}

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3">
            <span className="text-sm text-zinc-600">
              第 {page} / {totalPages} 页
            </span>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={(nextPage, nextSize) => {
                if (nextSize !== pageSize) {
                  setPageSize(nextSize);
                  setPage(1);
                } else {
                  setPage(nextPage);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
