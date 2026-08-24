import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import {
  Button,
  Image,
  Input,
  Modal,
  Pagination,
  Select,
  Table,
  Tag,
} from "antd";
import type { TableProps } from "antd";
import * as api from "../api";
import type { AiSummaryTaskEntry, AiSummaryTaskStatus } from "../types";

const statusOptions = [
  { label: "待处理", value: "pending" },
  { label: "处理中", value: "analyzing" },
  { label: "完成", value: "completed" },
  { label: "失败", value: "failed" },
];

const pageSizeOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
];

const statusTagColor: Record<string, string> = {
  pending: "gold",
  analyzing: "blue",
  failed: "red",
  completed: "green",
};

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

function formatMetaTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function isInProgress(task: AiSummaryTaskEntry): boolean {
  return task.status === "pending" || task.status === "analyzing";
}

interface Filters {
  status: AiSummaryTaskStatus[];
  search: string;
  updatedFrom: string;
  updatedTo: string;
}

const emptyFilters: Filters = {
  status: [],
  search: "",
  updatedFrom: "",
  updatedTo: "",
};

export function Component() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [rawOpen, setRawOpen] = useState(false);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawTitle, setRawTitle] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [rawError, setRawError] = useState("");
  const [rawIsFallbackError, setRawIsFallbackError] = useState(false);
  const [rawTask, setRawTask] = useState<AiSummaryTaskEntry | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState("");

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryTitle, setSummaryTitle] = useState("");
  const [summaryContent, setSummaryContent] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryFullscreen, setSummaryFullscreen] = useState(false);
  const [summaryMeta, setSummaryMeta] = useState<api.SummaryMarkdownMeta>({});

  const query = useQuery({
    queryKey: ["summary-tasks", filters, page, pageSize],
    queryFn: () =>
      api.getAiSummaryTasks({
        page,
        pageSize,
        status: filters.status,
        search: filters.search.trim() || undefined,
        updatedFrom: toIsoStart(filters.updatedFrom),
        updatedTo: toIsoEnd(filters.updatedTo),
      }),
    retry: false,
  });

  const tasks = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = query.data?.hasMore ?? false;
  const loading = query.isLoading;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasActiveFilter = useMemo(
    () =>
      filters.status.length > 0 ||
      filters.search.trim() !== "" ||
      filters.updatedFrom !== "" ||
      filters.updatedTo !== "",
    [filters],
  );

  function applyFilters(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  async function refreshTasks() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete(task: AiSummaryTaskEntry) {
    setError("");
    try {
      await api.deleteAiSummaryTask(task.id);
      if (tasks.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await query.refetch();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "删除 AI 总结任务失败");
    }
  }

  async function handleRetrigger(task: AiSummaryTaskEntry) {
    setError("");
    try {
      await api.retriggerAiSummaryTask(task.id);
      await query.refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "重新 AI 总结失败");
    }
  }

  async function openRawResponse(task: AiSummaryTaskEntry) {
    setRawTask(task);
    setRawTitle((task.title || `${task.bvid}-${task.cid}`) + " - 原始返回");
    setRawContent("");
    setRawError("");
    setRawIsFallbackError(false);
    setRebuildMessage("");
    setRawOpen(true);
    setRawLoading(true);
    try {
      const result = await api.getAiSummaryTaskRawResponse(task.id);
      if (result.rawResponse) {
        setRawContent(result.rawResponse);
      } else if (task.errorMessage) {
        setRawContent(task.errorMessage);
        setRawIsFallbackError(true);
      } else {
        setRawContent("");
      }
    } catch (e: unknown) {
      setRawError(e instanceof Error ? e.message : "获取原始返回失败");
    } finally {
      setRawLoading(false);
    }
  }

  async function openSummary(task: AiSummaryTaskEntry) {
    setSummaryTitle((task.title || `${task.bvid}-${task.cid}`) + " - 总结");
    setSummaryContent("");
    setSummaryError("");
    setSummaryFullscreen(false);
    setSummaryMeta({});
    setSummaryOpen(true);
    setSummaryLoading(true);
    try {
      const result = await api.getAiSummaryTaskMarkdown(task.id);
      setSummaryContent(result.content);
      setSummaryMeta(result.meta ?? {});
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : "获取总结文档失败");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleRebuildFromRaw() {
    if (!rawTask) return;
    setRebuilding(true);
    setRebuildMessage("");
    setRawError("");
    try {
      await api.rebuildAiSummaryTask(rawTask.id);
      setRebuildMessage("已开始重新构建总结，请刷新任务状态后查看结果");
      await query.refetch();
    } catch (e: unknown) {
      setRawError(e instanceof Error ? e.message : "重新构建总结失败");
    } finally {
      setRebuilding(false);
    }
  }

  const columns: TableProps<AiSummaryTaskEntry>["columns"] = [
    {
      title: "视频标题",
      render: (_, task) => (
        <div>
          <div
            className="max-w-[260px] truncate font-medium text-zinc-900"
            title={task.title || ""}
          >
            {task.title || `${task.bvid}-${task.cid}`}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {task.bvid} / {task.cid}
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      render: (_, task) => (
        <div>
          <Tag color={statusTagColor[task.status] ?? "default"}>
            {statusLabel(task.status)}
          </Tag>
          {task.status === "failed" && task.errorMessage && (
            <div className="mt-1 max-w-[240px] break-all text-xs text-red-600">
              {task.errorMessage}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "模型",
      width: 100,
      render: (_, task) =>
        task.modelName ? (
          <span
            className="block max-w-[80px] truncate text-zinc-700"
            title={task.modelName}
          >
            {task.modelName}
          </span>
        ) : (
          <span className="text-zinc-400">—</span>
        ),
    },
    {
      title: "总结时间",
      width: 130,
      render: (_, task) => (
        <span className="whitespace-nowrap text-zinc-700">
          {summaryTime(task)}
        </span>
      ),
    },
    {
      title: "执行耗时",
      render: (_, task) => {
        const rows = timingRows(task);
        if (rows.length === 0) return <span className="text-zinc-400">—</span>;
        return (
          <div className="space-y-0.5 text-xs text-zinc-700">
            {rows.map((row) => (
              <div key={row}>{row}</div>
            ))}
          </div>
        );
      },
    },
    {
      title: "更新时间",
      width: 130,
      render: (_, task) => (
        <span className="whitespace-nowrap text-zinc-400">
          {formatTime(task.updatedAt)}
        </span>
      ),
    },
    {
      title: "操作",
      width: 300,
      render: (_, task) => (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            disabled={task.status !== "completed"}
            onClick={() => void openSummary(task)}
          >
            查看总结
          </Button>
          <Button size="small" onClick={() => void openRawResponse(task)}>
            查看原始
          </Button>
          <Button
            size="small"
            color={isInProgress(task) ? "default" : "green"}
            variant={isInProgress(task) ? "outlined" : "solid"}
            disabled={isInProgress(task)}
            onClick={() => void handleRetrigger(task)}
          >
            重新总结
          </Button>
          <Button
            size="small"
            color={isInProgress(task) ? "default" : "red"}
            variant={isInProgress(task) ? "outlined" : "solid"}
            disabled={isInProgress(task)}
            onClick={() => void handleDelete(task)}
          >
            {isInProgress(task) ? "进行中" : "删除"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            AI 总结任务
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            仅在点击按钮时刷新当前任务状态，不做自动刷新。
          </p>
        </div>
        <Button
          loading={refreshing}
          disabled={refreshing}
          onClick={() => void refreshTasks()}
        >
          {refreshing ? "刷新中..." : "刷新任务状态"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
        <span className="text-sm text-zinc-500">状态</span>
        <Select
          mode="multiple"
          value={filters.status}
          options={statusOptions}
          onChange={(v) => applyFilters({ ...filters, status: v })}
          placeholder="全部状态"
          style={{ width: 200 }}
          maxTagCount="responsive"
        />

        <span className="ml-2 text-sm text-zinc-500">标题</span>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="按视频标题搜索"
          style={{ width: 192 }}
          onPressEnter={() => applyFilters({ ...filters, search: searchInput })}
        />
        <Button
          size="small"
          onClick={() => applyFilters({ ...filters, search: searchInput })}
        >
          搜索
        </Button>
        {searchInput && (
          <Button
            size="small"
            onClick={() => {
              setSearchInput("");
              applyFilters({ ...filters, search: "" });
            }}
          >
            清除
          </Button>
        )}

        <span className="ml-2 text-sm text-zinc-500">更新自</span>
        <input
          type="date"
          value={filters.updatedFrom}
          onChange={(e) =>
            applyFilters({ ...filters, updatedFrom: e.target.value })
          }
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800"
        />
        <span className="text-sm text-zinc-500">至</span>
        <input
          type="date"
          value={filters.updatedTo}
          onChange={(e) =>
            applyFilters({ ...filters, updatedTo: e.target.value })
          }
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center text-zinc-500">
          {hasActiveFilter ? "无匹配的 AI 总结任务" : "暂无 AI 总结任务"}
        </div>
      )}

      {tasks.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <Table<AiSummaryTaskEntry>
              rowKey="id"
              size="small"
              pagination={false}
              columns={columns}
              dataSource={tasks}
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
              showSizeChanger
              pageSizeOptions={[10, 20, 50]}
              showTotal={(t) => `共 ${t} 条`}
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
        </>
      )}

      <Modal
        open={rawOpen}
        title={rawTitle}
        width={720}
        footer={
          rawTask?.status === "completed" ? (
            <div className="flex items-center gap-3">
              <Button
                loading={rebuilding}
                disabled={rebuilding}
                color={rebuilding ? "default" : "green"}
                variant={rebuilding ? "outlined" : "solid"}
                onClick={() => void handleRebuildFromRaw()}
              >
                {rebuilding ? "重新构建中..." : "重新构建总结"}
              </Button>
              {rebuildMessage && (
                <span className="text-sm text-emerald-600">
                  {rebuildMessage}
                </span>
              )}
            </div>
          ) : null
        }
        onCancel={() => setRawOpen(false)}
      >
        {rawLoading && (
          <div className="py-6 text-center text-sm text-zinc-500">
            加载中...
          </div>
        )}
        {!rawLoading && rawError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {rawError}
          </div>
        )}
        {!rawLoading && rawContent && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800">
            {rawContent}
          </pre>
        )}
        {!rawLoading && rawIsFallbackError && (
          <p className="mt-2 text-xs text-red-500">
            本次无模型原始返回，以上为记录中的错误信息
          </p>
        )}
        {!rawLoading && !rawContent && !rawIsFallbackError && (
          <div className="py-6 text-center text-sm text-zinc-400">
            无原始返回（历史记录或本次未成功返回模型内容）
          </div>
        )}
      </Modal>

      <Modal
        open={summaryOpen}
        title={
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{summaryTitle}</span>
            <Button
              type="text"
              size="small"
              icon={
                summaryFullscreen ? (
                  <FullscreenExitOutlined />
                ) : (
                  <FullscreenOutlined />
                )
              }
              onClick={() => setSummaryFullscreen((v) => !v)}
            >
              {summaryFullscreen ? "退出全屏" : "全屏"}
            </Button>
          </div>
        }
        width={summaryFullscreen ? "96vw" : 820}
        footer={null}
        onCancel={() => {
          setSummaryFullscreen(false);
          setSummaryOpen(false);
        }}
      >
        {summaryLoading && (
          <div className="py-6 text-center text-sm text-zinc-500">
            加载中...
          </div>
        )}
        {!summaryLoading && summaryError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {summaryError}
          </div>
        )}
        {!summaryLoading && !summaryError && summaryContent && (
          <>
            {(summaryMeta.videoUrl ||
              summaryMeta.model ||
              summaryMeta.createdAt) && (
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
                {summaryMeta.videoUrl && (
                  <a
                    href={summaryMeta.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    B站原视频
                  </a>
                )}
                {summaryMeta.model && (
                  <span className="inline-flex items-center gap-1">
                    模型：{summaryMeta.model}
                  </span>
                )}
                {summaryMeta.createdAt && (
                  <span className="inline-flex items-center gap-1">
                    生成于 {formatMetaTime(summaryMeta.createdAt)}
                  </span>
                )}
              </div>
            )}
            <div
              className={`md-preview overflow-auto rounded-lg border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-800 ${
                summaryFullscreen
                  ? "max-h-[calc(100vh-150px)]"
                  : "max-h-[70vh]"
              }`}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ node: _node, ...rest }) => (
                    <Image
                      src={rest.src}
                      alt={rest.alt}
                      className="my-3 rounded-lg border border-zinc-200"
                      style={{
                        maxHeight: 256,
                        maxWidth: "100%",
                        objectFit: "contain",
                      }}
                      preview={{ mask: "点击查看大图" }}
                    />
                  ),
                }}
              >
                {summaryContent}
              </ReactMarkdown>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
