import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Pagination, Select } from "antd";
import * as api from "../api";
import { useSettingsStore } from "../stores/settings";
import { useDownloadQueueStore } from "../stores/downloadQueue";
import type { AiPrompt, VideoPage, VideoSummary } from "../types";

type ListType = "user-videos" | "ugc-season" | "favorites" | "video";

interface ListItem {
  key: string;
  bvid: string;
  cid: number;
  title: string;
  displayTitle: string;
  cover?: string;
  duration: number;
  groupKey: string;
  groupColorClass: string;
  selected: boolean;
  downloaded: boolean;
  queuedTaskId?: number;
  autoSummaryEnabled: boolean;
  highlighted: boolean;
  taskStatus: string;
  summaryStatus: string;
}

type DownloadStatus =
  | "none"
  | "created"
  | "stopped"
  | "downloading"
  | "success"
  | "failed";

type AnalysisStatus =
  | "none"
  | "pending"
  | "analyzing"
  | "completed"
  | "failed";

function downloadStatusOf(status: string): DownloadStatus {
  return (status === "" ? "none" : status) as DownloadStatus;
}

function analysisStatusOf(status: string): AnalysisStatus {
  return (status === "" ? "none" : status) as AnalysisStatus;
}

function downloadBadge(status: string): { label: string; className: string } | null {
  if (status === "downloading") {
    return { label: "下载中", className: "text-sky-600" };
  }
  if (status === "success") {
    return { label: "已下载", className: "text-emerald-600" };
  }
  return null;
}

function analysisBadge(
  status: string,
): { label: string; className: string } | null {
  if (status === "pending" || status === "analyzing") {
    return { label: "正在分析", className: "text-amber-600" };
  }
  if (status === "completed") {
    return { label: "分析完成", className: "text-emerald-600" };
  }
  return null;
}

interface ListQueryData {
  items: ListItem[];
  total: number;
  hasMore: boolean;
  title: string;
}

const colorPalette = [
  "border-l-rose-500",
  "border-l-sky-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-fuchsia-500",
  "border-l-cyan-500",
];

function groupColorClass(groupKey: string): string {
  let hash = 0;
  for (let i = 0; i < groupKey.length; i++) {
    hash = (hash * 31 + groupKey.charCodeAt(i)) >>> 0;
  }
  return colorPalette[hash % colorPalette.length];
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function imageSrc(url?: string): string {
  if (!url) return "";
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeSinglePage(
  videos: VideoSummary[],
  currentBvid?: string,
): ListItem[] {
  return videos.map((video) => ({
    key: `${video.bvid}-${video.cid}`,
    bvid: video.bvid,
    cid: video.cid,
    title: video.title,
    displayTitle: video.title,
    cover: video.cover,
    duration: video.duration,
    groupKey: video.bvid,
    groupColorClass: groupColorClass(video.bvid),
    selected: false,
    downloaded: false,
    autoSummaryEnabled: false,
    highlighted: Boolean(currentBvid && currentBvid === video.bvid),
    taskStatus: "",
    summaryStatus: "",
  }));
}

function normalizeVideoPages(
  bvid: string,
  mainTitle: string,
  coverUrl: string,
  pages: VideoPage[],
  highlighted: boolean,
): ListItem[] {
  if (pages.length <= 1) {
    const single = pages[0];
    return [
      {
        key: `${bvid}-${single?.cid ?? 0}`,
        bvid,
        cid: single?.cid ?? 0,
        title: mainTitle,
        displayTitle: mainTitle,
        cover: coverUrl,
        duration: single?.duration ?? 0,
        groupKey: bvid,
        groupColorClass: groupColorClass(bvid),
        selected: false,
        downloaded: false,
        autoSummaryEnabled: false,
        highlighted,
        taskStatus: "",
        summaryStatus: "",
      },
    ];
  }

  return pages.map((pageInfo) => ({
    key: `${bvid}-${pageInfo.cid}`,
    bvid,
    cid: pageInfo.cid,
    title: mainTitle,
    displayTitle: `${mainTitle} P${pageInfo.page}`,
    cover: coverUrl,
    duration: pageInfo.duration,
    groupKey: bvid,
    groupColorClass: groupColorClass(bvid),
    selected: false,
    downloaded: false,
    autoSummaryEnabled: false,
    highlighted,
    taskStatus: "",
    summaryStatus: "",
  }));
}

export function Component() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const addTaskIds = useDownloadQueueStore((s) => s.addTaskIds);

  const type = useMemo<ListType | null>(() => {
    const raw = searchParams.get("type");
    if (
      raw === "user-videos" ||
      raw === "ugc-season" ||
      raw === "favorites" ||
      raw === "video"
    ) {
      return raw;
    }
    return null;
  }, [searchParams]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState<ListItem[]>([]);
  const [actionError, setActionError] = useState("");
  const [dirOpen, setDirOpen] = useState(false);
  const [dirValue, setDirValue] = useState("");
  const [queuePromptList, setQueuePromptList] = useState<AiPrompt[]>([]);
  const [queuePromptId, setQueuePromptId] = useState<number>();
  const [downloadFilter, setDownloadFilter] = useState<DownloadStatus[]>([]);
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisStatus[]>([]);

  const listQuery = useQuery({
    queryKey: [
      "parse-list",
      type,
      searchParams.get("mid"),
      searchParams.get("seasonId"),
      searchParams.get("mediaId"),
      searchParams.get("bvid"),
      searchParams.get("currentBvid"),
      page,
      pageSize,
    ],
    queryFn: async (): Promise<ListQueryData> => {
      let normalized: ListItem[] = [];
      let totalCount = 0;
      let hasMore = false;
      let listTitle = "解析结果";

      if (type === "user-videos") {
        const mid = parsePositiveInt(searchParams.get("mid"));
        if (!mid) throw new Error("缺少有效 mid 参数");
        listTitle = "投稿视频";
        const result = await api.getUserSpaceVideos(mid, page, pageSize);
        normalized = normalizeSinglePage(result.items);
        hasMore = result.hasMore;
        totalCount = result.total;
      } else if (type === "ugc-season") {
        const seasonId = parsePositiveInt(searchParams.get("seasonId"));
        if (!seasonId) throw new Error("缺少有效 seasonId 参数");
        listTitle = "UGC 合集";
        const result = await api.getUgcSeasonVideos(
          seasonId,
          page,
          pageSize,
        );
        const currentBvid = searchParams.get("currentBvid") ?? undefined;
        normalized = normalizeSinglePage(result.items, currentBvid);
        hasMore = result.hasMore;
        totalCount = result.total;
      } else if (type === "favorites") {
        const mediaId = parsePositiveInt(searchParams.get("mediaId"));
        if (!mediaId) throw new Error("缺少有效 mediaId 参数");
        listTitle = "收藏夹视频";
        const result = await api.getFavoritesVideos(mediaId, page, pageSize);
        normalized = normalizeSinglePage(result.items);
        hasMore = result.hasMore;
        totalCount = result.total;
      } else if (type === "video") {
        const bvid = searchParams.get("bvid") ?? "";
        if (!bvid) throw new Error("缺少有效 bvid 参数");
        listTitle = "视频分P";

        const parsed = await api.parseLink(bvid);
        if (parsed.type !== "video") throw new Error("视频解析类型异常");
        const parsedVideo = parsed.data as {
          bvid: string;
          title: string;
          coverUrl: string;
          pages: VideoPage[];
          ugcSeason?: {
            seasonId: number;
            sections: Array<{
              episodes: Array<{
                bvid: string;
                title: string;
                pages: VideoPage[];
              }>;
            }>;
          };
        };

        if (parsedVideo.ugcSeason?.seasonId) {
          const seasonResult = await api.getUgcSeasonVideos(
            parsedVideo.ugcSeason.seasonId,
            1,
            200,
          );
          normalized = normalizeSinglePage(
            seasonResult.items,
            parsedVideo.bvid,
          );
          hasMore = false;
        } else {
          normalized = normalizeVideoPages(
            parsedVideo.bvid,
            parsedVideo.title,
            parsedVideo.coverUrl,
            parsedVideo.pages,
            false,
          );
          hasMore = false;
        }
        totalCount = normalized.length;
      } else {
        throw new Error("缺少列表类型参数");
      }

      if (normalized.length > 0) {
        const response = await api.checkTasks(
          normalized.map((item) => ({ bvid: item.bvid, cid: item.cid })),
        );
        const itemMap = new Map<string, (typeof response)[number]>(
          response.map((r) => [`${r.bvid}-${r.cid}`, r]),
        );
        normalized = normalized.map((item) => {
          const task = itemMap.get(`${item.bvid}-${item.cid}`);
          return {
            ...item,
            downloaded: Boolean(task),
            queuedTaskId: task?.id,
            autoSummaryEnabled: (task?.autoSummary ?? 0) === 1,
            taskStatus: task?.status ?? "",
            summaryStatus: task?.summaryStatus ?? "",
          };
        });
      }

      return {
        items: normalized,
        total: totalCount,
        hasMore,
        title: listTitle,
      };
    },
    enabled: type !== null,
    retry: false,
  });

  useEffect(() => {
    if (listQuery.data) {
      setItems(listQuery.data.items);
    }
  }, [listQuery.data]);

  const selectedCount = items.filter((i) => i.selected).length;
  const total = listQuery.data?.total ?? 0;
  const title = listQuery.data?.title ?? "解析结果";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = type !== "video";

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          downloadFilter.length > 0 &&
          !downloadFilter.includes(downloadStatusOf(item.taskStatus))
        ) {
          return false;
        }
        if (
          analysisFilter.length > 0 &&
          !analysisFilter.includes(analysisStatusOf(item.summaryStatus))
        ) {
          return false;
        }
        return true;
      }),
    [items, downloadFilter, analysisFilter],
  );

  function toggleSelect(item: ListItem, checked: boolean) {
    setItems((prev) =>
      prev.map((i) => (i.key === item.key ? { ...i, selected: checked } : i)),
    );
  }

  function toggleAutoSummary(item: ListItem, checked: boolean) {
    setItems((prev) =>
      prev.map((i) =>
        i.key === item.key ? { ...i, autoSummaryEnabled: checked } : i,
      ),
    );
  }

  async function refreshDownloaded() {
    if (items.length === 0) return;
    try {
      const response = await api.checkTasks(
        items.map((item) => ({ bvid: item.bvid, cid: item.cid })),
      );
      const itemMap = new Map<string, (typeof response)[number]>(
        response.map((r) => [`${r.bvid}-${r.cid}`, r]),
      );
      setItems((prev) =>
        prev.map((item) => {
          const task = itemMap.get(`${item.bvid}-${item.cid}`);
          return {
            ...item,
            downloaded: Boolean(task),
            queuedTaskId: task?.id,
            autoSummaryEnabled: (task?.autoSummary ?? 0) === 1,
            taskStatus: task?.status ?? "",
            summaryStatus: task?.summaryStatus ?? "",
          };
        }),
      );
    } catch {
      // ignore
    }
  }

  function openDirDialog() {
    setDirValue("");
    setQueuePromptId(undefined);
    setDirOpen(true);
    void api
      .getPrompts()
      .then((result) => {
        setQueuePromptList(result.items);
        const defaultPrompt =
          result.items.find((p) => p.isDefault === 1) ?? result.items[0];
        setQueuePromptId(defaultPrompt?.id);
      })
      .catch(() => {
        setQueuePromptList([]);
      });
  }

  async function resolveCid(item: ListItem): Promise<number> {
    if (item.cid) return item.cid;
    const info = await api.getVideoInfo(item.bvid);
    const cid = info.cid ?? info.pages?.[0]?.cid ?? 0;
    if (!cid) throw new Error(`无法解析 ${item.bvid} 的分P信息`);
    return cid;
  }

  async function doAddToQueue(outputPath: string) {
    const selected = items.filter((i) => i.selected);
    if (selected.length === 0) return;

    setActionError("");
    try {
      const requests = selected.map(async (item) => {
        try {
          const cid = await resolveCid(item);
          return await api.createDownload({
            bvid: item.bvid,
            cid,
            title: item.displayTitle,
            quality: settings.defaultQuality,
            codec: settings.defaultCodec,
            subtitleLang: settings.downloadSubtitle ? "zh" : "none",
            fileNameTemplate: settings.defaultFileNameTemplate,
            outputPath,
            autoSummary: item.autoSummaryEnabled,
            promptId: queuePromptId,
          });
        } catch (e: unknown) {
          return {
            id: -1,
            message: e instanceof Error ? e.message : "加入队列失败",
          };
        }
      });
      const responses = await Promise.all(requests);
      const successIds = responses
        .filter((r) => r.id !== -1)
        .map((r) => r.id);
      addTaskIds(successIds);

      const failed = responses.filter((r) => r.id === -1 && r.message);
      if (failed.length > 0) {
        setActionError(
          `部分任务加入失败：${failed.map((f) => f.message).join("；")}`,
        );
      }

      const selectedKeys = new Set(selected.map((i) => i.key));
      setItems((prev) =>
        prev.map((item) =>
          selectedKeys.has(item.key)
            ? { ...item, downloaded: true, selected: false }
            : item,
        ),
      );
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "加入队列失败");
    }
  }

  async function handleOneClickAiSummary(item: ListItem) {
    if (item.autoSummaryEnabled && item.downloaded) return;

    try {
      if (!item.downloaded) {
        await api.triggerAiSummary({ bvid: item.bvid, cid: item.cid });
        setItems((prev) =>
          prev.map((i) =>
            i.key === item.key
              ? { ...i, downloaded: true, autoSummaryEnabled: true }
              : i,
          ),
        );
        await refreshDownloaded();
        return;
      }

      if (!item.queuedTaskId) {
        await refreshDownloaded();
      }

      const queuedTaskId = items.find((i) => i.key === item.key)?.queuedTaskId;
      if (!queuedTaskId) {
        throw new Error("无法定位任务 ID");
      }

      if (!item.autoSummaryEnabled) {
        await api.setAutoSummary(queuedTaskId, true);
        setItems((prev) =>
          prev.map((i) =>
            i.key === item.key ? { ...i, autoSummaryEnabled: true } : i,
          ),
        );
        await api
          .triggerAiSummary({ bvid: item.bvid, cid: item.cid })
          .catch(() => undefined);
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "AI 总结操作失败");
    }
  }

  function isNewGroup(index: number): boolean {
    if (index === 0) return true;
    return items[index - 1].groupKey !== items[index].groupKey;
  }

  function groupClass(index: number): string {
    const item = items[index];
    const spacing = isNewGroup(index) ? "mt-4" : "mt-1";
    const highlight = item.highlighted ? "ring-1 ring-rose-400/70" : "";
    return `${spacing} border-l-4 ${item.groupColorClass} ${highlight}`;
  }

  const loading = listQuery.isLoading;
  const error =
    listQuery.isError && !loading
      ? listQuery.error instanceof Error
        ? listQuery.error.message
        : "加载失败"
      : "";

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-zinc-500">列表类型</p>
          <p className="text-sm font-semibold text-zinc-900">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
            onClick={() => navigate("/")}
          >
            返回首页
          </button>
          <span className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700">
            AI 总结
          </span>
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-zinc-500">
          正在加载列表...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {actionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {actionError}
            </div>
          )}

          <div className="rounded-lg border border-zinc-200 bg-white p-4 flex items-center justify-between">
            <span className="text-sm text-zinc-600">
              已选择 {selectedCount} 项
            </span>
            <Button
              color="green"
              variant="solid"
              size="small"
              disabled={selectedCount === 0}
              onClick={openDirDialog}
            >
              加入待下载
            </Button>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 flex flex-wrap items-center gap-4">
            <span className="text-sm text-zinc-500">筛选</span>
            <Select
              mode="multiple"
              allowClear
              placeholder="下载状态"
              size="small"
              style={{ width: 200 }}
              value={downloadFilter}
              options={[
                { value: "none", label: "无任务" },
                { value: "created", label: "排队中" },
                { value: "stopped", label: "已停止" },
                { value: "downloading", label: "下载中" },
                { value: "success", label: "已下载" },
                { value: "failed", label: "下载失败" },
              ]}
              onChange={(v) => setDownloadFilter(v ?? [])}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="分析状态"
              size="small"
              style={{ width: 200 }}
              value={analysisFilter}
              options={[
                { value: "none", label: "无记录" },
                { value: "pending", label: "等待中" },
                { value: "analyzing", label: "正在分析" },
                { value: "completed", label: "分析完成" },
                { value: "failed", label: "分析失败" },
              ]}
              onChange={(v) => setAnalysisFilter(v ?? [])}
            />
          </div>

          <div>
            {visibleItems.map((item, idx) => (
              <div
                key={item.key}
                className={`rounded-r-lg border border-zinc-200 bg-white p-3 ${groupClass(idx)}`}
              >
                <div className="flex gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={item.selected}
                    onChange={(e) => toggleSelect(item, e.target.checked)}
                  />
                  {item.cover && (
                    <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-zinc-100">
                      <img
                        src={imageSrc(item.cover)}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-900">
                        {item.displayTitle}
                      </p>
                      {(() => {
                        const badge = downloadBadge(item.taskStatus);
                        return badge ? (
                          <span className={`text-xs ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : null;
                      })()}
                      {(() => {
                        const badge = analysisBadge(item.summaryStatus);
                        return badge ? (
                          <span className={`text-xs ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : null;
                      })()}
                      {item.highlighted && (
                        <span className="text-xs text-rose-600">当前视频</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      时长：{formatDuration(item.duration)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Checkbox
                        checked={item.autoSummaryEnabled}
                        onChange={(e) =>
                          toggleAutoSummary(item, e.target.checked)
                        }
                      >
                        <span className="text-xs text-zinc-700">
                          AI 总结开关
                        </span>
                      </Checkbox>
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1 text-xs ${
                          item.autoSummaryEnabled && item.downloaded
                            ? "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                            : "bg-rose-600 text-white hover:bg-rose-500"
                        }`}
                        disabled={item.autoSummaryEnabled && item.downloaded}
                        onClick={() => void handleOneClickAiSummary(item)}
                      >
                        一键 AI 总结
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {visibleItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
                当前筛选条件下没有匹配的视频
              </div>
            )}
          </div>

          {showPagination && (
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
          )}
        </>
      )}

      <Modal
        open={dirOpen}
        title="确认下载子目录"
        okText="确认"
        cancelText="取消"
        okButtonProps={{ disabled: !dirValue.trim() }}
        onOk={() => {
          setDirOpen(false);
          void doAddToQueue(dirValue.trim());
        }}
        onCancel={() => setDirOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm text-zinc-600">
            请确认下载根目录下的相对子目录：
          </label>
          <Input
            value={dirValue}
            onChange={(e) => setDirValue(e.target.value)}
            placeholder="例如：批量解析/收藏夹"
          />
          {!dirValue.trim() && (
            <p className="text-xs text-red-600">目录不能为空</p>
          )}
          <label className="text-sm text-zinc-600">
            AI 总结提示词（写入选中的下载任务，AI 总结开启时生效）
          </label>
          <Select
            value={queuePromptId}
            onChange={(v) => setQueuePromptId(v)}
            options={queuePromptList.map((p) => ({
              label:
                p.name +
                (p.isDefault === 1 ? "（默认）" : "") +
                (p.isSystem === 1 ? "（内置）" : ""),
              value: p.id,
            }))}
            placeholder="加载提示词..."
            style={{ width: "100%" }}
          />
        </div>
      </Modal>
    </div>
  );
}
