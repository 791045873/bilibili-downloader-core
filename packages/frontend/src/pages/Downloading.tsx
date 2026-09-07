import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Modal,
  Progress,
  Select,
  Pagination,
  Table,
  Tag,
} from "antd";
import type { TableProps } from "antd";
import * as api from "../api";
import { useResizableColumns } from "../components/useResizableColumns";
import type {
  AiPrompt,
  PromptCreatorBinding,
  TaskEntry,
  TaskStatusGroup,
} from "../types";

const statusGroupOptions = [
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

const statusTagColor: Record<string, string> = {
  downloading: "blue",
  success: "green",
  failed: "red",
  created: "gold",
  stopped: "default",
};

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

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusGroup, setStatusGroup] = useState<TaskStatusGroup[]>([]);
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryTask, setSummaryTask] = useState<TaskEntry | null>(null);
  const [summaryPrompts, setSummaryPrompts] = useState<AiPrompt[]>([]);
  const [summaryPromptId, setSummaryPromptId] = useState<number>();
  const [summarySetDefault, setSummarySetDefault] = useState(false);
  const [summaryApplyCreator, setSummaryApplyCreator] = useState(false);
  const [summaryUnbind, setSummaryUnbind] = useState(false);
  const [summaryMid, setSummaryMid] = useState<number>();
  const [summaryUpperName, setSummaryUpperName] = useState<string>();
  const [summaryBinding, setSummaryBinding] =
    useState<PromptCreatorBinding | null>(null);
  const [summaryModalLoading, setSummaryModalLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const promptsQuery = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.getPrompts(),
  });

  // 页内存在非终态任务时每 3s 轮询一次列表，全部终态自动停止
  const listQuery = useQuery({
    queryKey: ["tasks", page, pageSize, statusGroup],
    queryFn: () => api.getTasks({ page, pageSize, statusGroup }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some(isActiveTask) ? 3000 : false;
    },
  });

  const tasks = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const loading = listQuery.isLoading;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCount = tasks.filter(isActiveTask).length;
  const successCount = tasks.filter((t) => t.status === "success").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;

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
      await listQuery.refetch();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "暂停任务失败");
    }
  }

  async function handleResume(id: number) {
    setActionError("");
    try {
      await api.resumeTask(id);
      await listQuery.refetch();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "恢复任务失败");
    }
  }

  async function openSummaryModal(task: TaskEntry) {
    setSummaryTask(task);
    setSummaryPromptId(undefined);
    setSummarySetDefault(false);
    setSummaryApplyCreator(false);
    setSummaryUnbind(false);
    setSummaryMid(undefined);
    setSummaryUpperName(undefined);
    setSummaryBinding(null);
    setSummaryError("");
    setSummaryOpen(true);
    setSummaryModalLoading(true);
    try {
      let promptList = promptsQuery.data?.items ?? [];
      if (promptList.length === 0) {
        try {
          promptList = (await api.getPrompts()).items;
        } catch {
          // 提示词列表不可用时不阻断弹窗打开
        }
      }
      setSummaryPrompts(promptList);

      let mid: number | undefined;
      let upperName: string | undefined;
      if (task.bvid) {
        try {
          const info = await api.getVideoInfo(task.bvid);
          mid = info.videoInfo?.upperMid;
          upperName = info.videoInfo?.upperName;
        } catch {
          // 创作者信息解析失败仅影响默认选中与绑定入口
        }
      }
      setSummaryMid(mid);
      setSummaryUpperName(upperName);

      let binding: PromptCreatorBinding | null = null;
      if (typeof mid === "number") {
        try {
          binding = await api.getCreatorPromptBinding(mid);
        } catch {
          // 绑定查询失败仅影响默认选中
        }
      }
      setSummaryBinding(binding);

      const defaultPrompt =
        promptList.find((p) => p.isDefault === 1) ?? promptList[0];
      setSummaryPromptId(binding?.promptId ?? defaultPrompt?.id);
    } finally {
      setSummaryModalLoading(false);
    }
  }

  async function handleTriggerAiSummary(id: number) {
    setActionError("");
    const existing = tasks.find((t) => t.id === id);
    if (
      !existing ||
      !(existing.status === "success" &&
        !isSummaryRunning(existing.summaryStatus))
    ) {
      return;
    }
    await openSummaryModal(existing);
  }

  async function handleSummaryConfirm() {
    if (!summaryTask || summaryPromptId === undefined) return;
    setSummaryError("");
    setSummaryModalLoading(true);
    try {
      if (summarySetDefault) {
        await api.setDefaultPrompt(summaryPromptId);
      }
      if (summaryMid !== undefined && summaryApplyCreator) {
        await api.setCreatorPromptBinding(summaryMid, summaryPromptId);
      }
      if (summaryMid !== undefined && summaryUnbind) {
        await api.deleteCreatorPromptBinding(summaryMid);
      }
      await api.triggerTaskAiSummary(summaryTask.id, summaryPromptId);
      setSummaryOpen(false);
      await listQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : "触发 AI 总结失败");
    } finally {
      setSummaryModalLoading(false);
    }
  }

  function boundPromptName(): string {
    if (!summaryBinding) return "";
    const name = summaryPrompts.find(
      (p) => p.id === summaryBinding!.promptId,
    )?.name;
    return name || `#${summaryBinding.promptId}`;
  }

  const columns: TableProps<TaskEntry>["columns"] = [
    {
      title: "任务",
      render: (_, task) => (
        <div>
          <div
            className="max-w-[280px] truncate font-medium text-zinc-900"
            title={task.title || ""}
          >
            {task.title || "(无标题)"}
          </div>
          {task.outputFile && (
            <code
              className="mt-0.5 block max-w-[280px] truncate text-xs text-zinc-500"
              title={task.outputFile}
            >
              {task.outputFile}
            </code>
          )}
        </div>
      ),
    },
    {
      title: "状态",
      width: 110,
      render: (_, task) => (
        <div>
          <Tag color={statusTagColor[task.status] ?? "default"}>
            {statusLabel(task.status)}
          </Tag>
          {task.status === "failed" && task.errorMessage && (
            <div
              className="mt-1 max-w-[220px] break-all text-xs text-red-600"
              title={task.errorMessage}
            >
              {task.errorMessage}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "进度",
      width: 160,
      render: (_, task) =>
        task.status === "downloading" ? (
          <Progress
            percent={task.progress ?? 0}
            size="small"
            style={{ maxWidth: 140 }}
          />
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      title: "大小",
      width: 90,
      render: (_, task) =>
        task.status === "success" && task.fileSize ? (
          <span className="whitespace-nowrap text-zinc-700">
            {formatBytes(task.fileSize)}
          </span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      title: "AI 总结",
      width: 100,
      render: (_, task) =>
        task.status === "success" ? (
          <span className="text-zinc-700">
            {summaryStatusLabel(task.summaryStatus)}
          </span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 250,
      render: (_, task) => {
        const canTrigger =
          task.status === "success" && !isSummaryRunning(task.summaryStatus);
        return (
          <div className="flex items-center gap-2">
            {task.status === "created" && (
              <Button size="small" onClick={() => void handleStop(task.id)}>
                暂停
              </Button>
            )}
            {task.status === "stopped" && (
              <Button
                size="small"
                color="green"
                variant="outlined"
                onClick={() => void handleResume(task.id)}
              >
                恢复
              </Button>
            )}
            {task.status === "downloading" && (
              <Button
                size="small"
                color="red"
                variant="outlined"
                onClick={() => void handleDelete(task.id)}
              >
                取消
              </Button>
            )}
            {task.status === "success" && (
              <Button
                size="small"
                color="red"
                variant="outlined"
                disabled={!canTrigger}
                onClick={() => void handleTriggerAiSummary(task.id)}
              >
                {aiSummaryButtonLabel(task)}
              </Button>
            )}
            {task.status !== "downloading" && (
              <Button
                size="small"
                color="red"
                variant="solid"
                onClick={() => void handleDelete(task.id)}
              >
                删除
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const { columns: tableColumns, components } = useResizableColumns<TaskEntry>(
    columns,
    { fixedKeys: ["actions"] },
  );

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
          mode="multiple"
          value={statusGroup}
          options={statusGroupOptions}
          onChange={(v) => {
            setStatusGroup(v);
            setPage(1);
          }}
          placeholder="全部任务"
          style={{ width: 220 }}
          maxTagCount="responsive"
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
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <Table<TaskEntry>
              rowKey="id"
              size="small"
              pagination={false}
              columns={tableColumns}
              components={components}
              dataSource={tasks}
              loading={loading}
            />
          </div>

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

      <Modal
        open={summaryOpen}
        title="选择 AI 总结提示词"
        width={520}
        okText="确认"
        cancelText="取消"
        confirmLoading={summaryModalLoading}
        onOk={() => void handleSummaryConfirm()}
        onCancel={() => setSummaryOpen(false)}
      >
        {summaryModalLoading ? (
          <div className="py-6 text-center text-sm text-zinc-500">加载中...</div>
        ) : (
          <div className="flex flex-col gap-3">
            {summaryError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {summaryError}
              </div>
            )}
            <label className="text-sm text-zinc-600">提示词</label>
            <Select
              value={summaryPromptId}
              onChange={(v) => setSummaryPromptId(v)}
              options={summaryPrompts.map((p) => ({
                label:
                  p.name + (p.isDefault === 1 ? "（默认）" : "") +
                  (p.isSystem === 1 ? "（内置）" : ""),
                value: p.id,
              }))}
              style={{ width: "100%" }}
            />
            <Checkbox
              checked={summarySetDefault}
              onChange={(e) => setSummarySetDefault(e.target.checked)}
            >
              设为默认提示词
            </Checkbox>
            <Checkbox
              checked={summaryApplyCreator}
              disabled={summaryMid === undefined}
              onChange={(e) => setSummaryApplyCreator(e.target.checked)}
            >
              应用到该创作者
              {summaryUpperName
                ? `（${summaryUpperName}）`
                : summaryMid !== undefined
                  ? `（mid ${summaryMid}）`
                  : ""}
            </Checkbox>
            {summaryBinding && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2">
                <span className="text-xs text-zinc-600">
                  该创作者当前绑定提示词：{boundPromptName()}
                </span>
                <Button
                  size="small"
                  color="red"
                  variant="outlined"
                  onClick={() => setSummaryUnbind((prev) => !prev)}
                >
                  {summaryUnbind ? "已选择解除" : "解除绑定"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
