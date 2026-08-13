import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Table,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import * as api from "../api";
import { useSettingsStore } from "../stores/settings";
import { useDownloadQueueStore } from "../stores/downloadQueue";
import type {
  SubtitleLang,
  VideoInfo,
  VideoPage,
} from "../types";

interface PageState {
  resolved: boolean;
  downloaded: boolean;
  qualityList?: { id: number; name: string; codecList: string[] }[];
  audioQualityList?: string[];
  selectedQuality?: number;
  selectedCodec?: string;
  selectedAudio?: string;
  selectedSubtitleLang: SubtitleLang;
}

interface EpisodeRow {
  key: string;
  title: string;
  children: PageRow[];
}

interface PageRow {
  key: string;
  cid: number;
  page: VideoPage;
}

type RowData = EpisodeRow | PageRow;

const subtitleOptions = [
  { label: "不下载", value: "none" },
  { label: "中文", value: "zh" },
  { label: "英文", value: "en" },
  { label: "全部字幕", value: "all" },
];

function defaultPageState(): PageState {
  return { resolved: false, downloaded: false, selectedSubtitleLang: "none" };
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Component() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const input = (searchParams.get("input") ?? "").trim();
  const settings = useSettingsStore((s) => s.settings);
  const addTaskIds = useDownloadQueueStore((s) => s.addTaskIds);

  const { data: videoInfo, isLoading, isError, error } = useQuery({
    queryKey: ["video-info", input],
    queryFn: () => api.getVideoInfo(input),
    enabled: input.length > 0,
    retry: false,
  });

  const [selectedSectionId, setSelectedSectionId] = useState(0);
  const [pageStates, setPageStates] = useState<Record<string, PageState>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [parsing, setParsing] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const [dirValue, setDirValue] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  function patchPageState(key: string, patch: Partial<PageState>) {
    setPageStates((prev) => ({
      ...prev,
      [key]: { ...defaultPageState(), ...prev[key], ...patch },
    }));
  }

  // 默认选中第一个 section；非合集模式用 -1 表示平铺
  useEffect(() => {
    if (!videoInfo) return;
    const sections = videoInfo.ugcSeason?.sections;
    if (sections && sections.length > 0) {
      setSelectedSectionId((prev) =>
        sections.some((s) => s.id === prev) ? prev : sections[0].id,
      );
    } else {
      setSelectedSectionId(-1);
    }
  }, [videoInfo]);

  // 初始下载态：checkTasks 入队去重
  useEffect(() => {
    if (!videoInfo) return;
    const entries: { key: string; cid: number }[] = [];
    if (videoInfo.ugcSeason?.sections) {
      for (const sec of videoInfo.ugcSeason.sections) {
        for (const ep of sec.episodes) {
          for (const p of ep.pages) {
            entries.push({ key: `${sec.id}-${ep.cid}-${p.cid}`, cid: p.cid });
          }
        }
      }
    } else {
      for (const p of videoInfo.pages) {
        entries.push({ key: `video-${videoInfo.bvid}-${p.cid}`, cid: p.cid });
      }
    }
    if (entries.length === 0) return;
    void api
      .checkTasks(
        entries.map((e) => ({ bvid: videoInfo.bvid, cid: e.cid })),
      )
      .then((records) => {
        const downloaded = new Set(
          records.map((r) => `${r.bvid}-${r.cid}`),
        );
        const patches: Record<string, Partial<PageState>> = {};
        entries.forEach((e) => {
          if (downloaded.has(`${videoInfo.bvid}-${e.cid}`)) {
            patches[e.key] = { downloaded: true };
          }
        });
        setPageStates((prev) => {
          const next = { ...prev };
          Object.entries(patches).forEach(([key, p]) => {
            next[key] = { ...defaultPageState(), ...next[key], ...p };
          });
          return next;
        });
      })
      .catch(() => undefined);
  }, [videoInfo]);

  const currentTree = useMemo<EpisodeRow[]>(() => {
    if (!videoInfo) return [];
    if (videoInfo.ugcSeason?.sections) {
      const section = videoInfo.ugcSeason.sections.find(
        (s) => s.id === selectedSectionId,
      );
      return (section?.episodes ?? []).map((ep) => ({
        key: `${selectedSectionId}-${ep.cid}`,
        title: ep.title,
        children: ep.pages.map((p) => ({
          key: `${selectedSectionId}-${ep.cid}-${p.cid}`,
          cid: p.cid,
          page: p,
        })),
      }));
    }
    return [
      {
        key: `video-${videoInfo.bvid}`,
        title: videoInfo.title,
        children: videoInfo.pages.map((p) => ({
          key: `video-${videoInfo.bvid}-${p.cid}`,
          cid: p.cid,
          page: p,
        })),
      },
    ];
  }, [videoInfo, selectedSectionId]);

  const currentSectionTitle = useMemo(() => {
    if (!videoInfo?.ugcSeason?.sections) return "";
    return (
      videoInfo.ugcSeason.sections.find((s) => s.id === selectedSectionId)
        ?.title ?? ""
    );
  }, [videoInfo, selectedSectionId]);

  const currentSectionDefaultPath = useMemo(() => {
    if (!videoInfo) return "";
    return videoInfo.ugcSeason?.title
      ? `${videoInfo.ugcSeason.title}/${currentSectionTitle}`
      : videoInfo.title;
  }, [videoInfo, currentSectionTitle]);

  const allSelectedCount = selectedKeys.size;

  function getPageState(key: string): PageState {
    return pageStates[key] ?? defaultPageState();
  }

  function episodePageKeys(epKey: string): string[] {
    const ep = currentTree.find((e) => e.key === epKey);
    return ep ? ep.children.map((c) => c.key) : [];
  }

  function episodeSelectState(epKey: string): boolean | null {
    const keys = episodePageKeys(epKey);
    if (keys.length === 0) return false;
    const sel = keys.filter((k) => selectedKeys.has(k)).length;
    if (sel === keys.length) return true;
    if (sel === 0) return false;
    return null;
  }

  function toggleEpisode(epKey: string) {
    const keys = episodePageKeys(epKey);
    if (keys.length === 0) return;
    const allSel = keys.every((k) => selectedKeys.has(k));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allSel ? next.delete(k) : next.add(k)));
      return next;
    });
  }

  function sectionSelectState(): boolean | null {
    let allPages = 0;
    let selPages = 0;
    currentTree.forEach((ep) => {
      ep.children.forEach((p) => {
        allPages++;
        if (selectedKeys.has(p.key)) selPages++;
      });
    });
    if (allPages === 0) return false;
    if (selPages === allPages) return true;
    if (selPages === 0) return false;
    return null;
  }

  function toggleSection() {
    const allSel = sectionSelectState() === true;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      currentTree.forEach((ep) =>
        ep.children.forEach((p) =>
          allSel ? next.delete(p.key) : next.add(p.key),
        ),
      );
      return next;
    });
  }

  async function handleParseAllInSection() {
    if (!videoInfo) return;
    setParsing(true);
    setErrorMsg("");
    try {
      const unresolved: { key: string; cid: number }[] = [];
      currentTree.forEach((ep) => {
        ep.children.forEach((p) => {
          if (!getPageState(p.key).resolved) {
            unresolved.push({ key: p.key, cid: p.cid });
          }
        });
      });
      if (unresolved.length === 0) return;

      const results = await api.parseAllVideos(
        videoInfo.bvid,
        unresolved.map((u) => u.cid),
      );
      const patches: Record<string, Partial<PageState>> = {};
      results.forEach((result) => {
        const target = unresolved.find((u) => u.cid === result.cid);
        if (!target) return;
        patches[target.key] = {
          resolved: true,
          qualityList: result.videoQualityList,
          audioQualityList: result.audioQualityList,
          selectedQuality:
            result.videoQualityList[0]?.id ?? settings.defaultQuality,
          selectedCodec: result.videoQualityList[0]?.codecList[0] ?? "AVC",
          selectedAudio:
            result.audioQualityList[0] ?? settings.defaultAudioQuality,
          selectedSubtitleLang: "none",
        };
      });
      setPageStates((prev) => {
        const next = { ...prev };
        Object.entries(patches).forEach(([key, p]) => {
          next[key] = { ...defaultPageState(), ...next[key], ...p };
        });
        return next;
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "解析失败");
    } finally {
      setParsing(false);
    }
  }

  function openDirDialog() {
    setDirValue(currentSectionDefaultPath);
    setDirOpen(true);
  }

  async function doAddToQueue(outputPath: string) {
    if (!videoInfo) return;
    const tasks: Promise<{ id: number; message: string }>[] = [];
    currentTree.forEach((ep) => {
      ep.children.forEach((p) => {
        if (!selectedKeys.has(p.key)) return;
        const st = getPageState(p.key);
        const vq = st.selectedQuality ?? settings.defaultQuality;
        const codec = st.selectedCodec || settings.defaultCodec || undefined;
        const subtitleLang = st.selectedSubtitleLang || "none";
        tasks.push(
          api.createDownload({
            bvid: videoInfo.bvid,
            cid: p.cid,
            title: `${ep.title} - P${p.page.page} ${p.page.title}`,
            quality: vq,
            codec,
            outputPath,
            fileNameTemplate: settings.defaultFileNameTemplate,
            subtitleLang,
          }),
        );
      });
    });

    try {
      const responses = await Promise.all(
        tasks.map((t) => t.catch(() => ({ id: -1, message: "" }))),
      );
      const successIds = responses
        .filter((r) => r.id !== -1)
        .map((r) => r.id);
      addTaskIds(successIds);

      setSelectedKeys((prev) => {
        const next = new Set(prev);
        currentTree.forEach((ep) =>
          ep.children.forEach((p) => next.delete(p.key)),
        );
        return next;
      });
      setPageStates((prev) => {
        const next = { ...prev };
        currentTree.forEach((ep) =>
          ep.children.forEach((p) => {
            if (next[p.key]) {
              next[p.key] = { ...next[p.key], downloaded: true };
            }
          }),
        );
        return next;
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "加入队列失败");
    }
  }

  const columns: TableProps<RowData>["columns"] = [
    {
      title: "选择",
      width: 70,
      render: (_, record) =>
        "children" in record ? (
          <Checkbox
            checked={episodeSelectState(record.key) === true}
            indeterminate={episodeSelectState(record.key) === null}
            onChange={() => toggleEpisode(record.key)}
          />
        ) : (
          <Checkbox
            checked={selectedKeys.has(record.key)}
            onChange={(e) => {
              setSelectedKeys((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(record.key);
                else next.delete(record.key);
                return next;
              });
            }}
          />
        ),
    },
    {
      title: "名称",
      render: (_, record) =>
        "children" in record ? (
          <span className="text-zinc-800 font-medium">{record.title}</span>
        ) : (
          <span className="text-zinc-600 pl-4 text-xs">
            P{record.page.page} {record.page.title}
            {getPageState(record.key).downloaded && (
              <span className="ml-2 text-emerald-600">已下载</span>
            )}
          </span>
        ),
    },
    {
      title: "时长",
      width: 90,
      render: (_, record) =>
        "children" in record ? (
          <span className="text-zinc-500 text-xs"> </span>
        ) : (
          <span className="text-zinc-500 text-xs">
            {formatDuration(record.page.duration)}
          </span>
        ),
    },
    {
      title: "画质",
      width: 130,
      render: (_, record) => {
        if ("children" in record) return <span className="text-zinc-400 text-xs">-</span>;
        const st = getPageState(record.key);
        if (!st.resolved) {
          return <span className="text-xs text-amber-500">待解析</span>;
        }
        if (!st.qualityList?.length) {
          return <span className="text-xs text-zinc-400">-</span>;
        }
        return (
          <Select
            size="small"
            className="w-full"
            value={st.selectedQuality}
            options={st.qualityList.map((q) => ({
              label: q.name,
              value: q.id,
            }))}
            onChange={(v) => patchPageState(record.key, { selectedQuality: v })}
          />
        );
      },
    },
    {
      title: "编码",
      width: 110,
      render: (_, record) => {
        if ("children" in record) return <span className="text-zinc-400 text-xs">-</span>;
        const st = getPageState(record.key);
        if (!st.qualityList?.length) {
          return <span className="text-xs text-zinc-400">-</span>;
        }
        const codecs =
          st.qualityList.find((q) => q.id === st.selectedQuality)?.codecList ??
          [];
        return (
          <Select
            size="small"
            className="w-full"
            value={st.selectedCodec}
            options={codecs.map((c) => ({ label: c, value: c }))}
            onChange={(v) => patchPageState(record.key, { selectedCodec: v })}
          />
        );
      },
    },
    {
      title: "字幕",
      width: 120,
      render: (_, record) => {
        if ("children" in record) return <span className="text-zinc-400 text-xs">-</span>;
        const st = getPageState(record.key);
        if (!st.resolved) {
          return <span className="text-xs text-amber-500">待解析</span>;
        }
        return (
          <Select
            size="small"
            className="w-full"
            value={st.selectedSubtitleLang}
            options={subtitleOptions}
            onChange={(v) =>
              patchPageState(record.key, {
                selectedSubtitleLang: v as SubtitleLang,
              })
            }
          />
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        正在加载...
      </div>
    );
  }

  if (isError || !videoInfo) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-red-600">
          {isError && error instanceof Error
            ? error.message
            : "获取视频信息失败"}
        </p>
        <button
          type="button"
          className="mt-3 text-sm text-zinc-600 hover:text-zinc-900"
          onClick={() => navigate("/")}
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMsg}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-5 flex gap-5">
        {videoInfo.videoInfo.coverUrl && (
          <div className="w-48 h-28 bg-zinc-100 rounded overflow-hidden shrink-0">
            <img
              src={`/api/video/cover?url=${encodeURIComponent(
                videoInfo.videoInfo.coverUrl,
              )}`}
              alt={videoInfo.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Typography.Title level={4} style={{ marginBottom: 8 }}>
            {videoInfo.title}
          </Typography.Title>
          <div className="flex flex-wrap gap-3 text-sm text-zinc-600">
            <span>UP：{videoInfo.videoInfo.upperName}</span>
            <span>播放：{videoInfo.videoInfo.playCount}</span>
            {videoInfo.ugcSeason && (
              <span className="text-rose-600">
                合集：{videoInfo.ugcSeason.title}
              </span>
            )}
          </div>
        </div>
      </div>

      {videoInfo.ugcSeason?.sections && (
        <div className="flex flex-wrap gap-2">
          {videoInfo.ugcSeason.sections.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedSectionId === sec.id
                  ? "bg-rose-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
              onClick={() => setSelectedSectionId(sec.id)}
            >
              {sec.title}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-2">
          <Button
            color="red"
            variant="solid"
            size="small"
            loading={parsing}
            disabled={parsing}
            onClick={() => void handleParseAllInSection()}
          >
            解析当前页所有视频
          </Button>
          <Button
            color="green"
            variant="solid"
            size="small"
            disabled={allSelectedCount === 0}
            onClick={openDirDialog}
          >
            加入下载队列
          </Button>
        </div>
        <span className="text-sm text-zinc-500">
          已选中 {allSelectedCount} 个分P
        </span>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
          <Checkbox
            checked={sectionSelectState() === true}
            indeterminate={sectionSelectState() === null}
            onChange={toggleSection}
          />
          <span className="text-sm font-medium text-zinc-800">
            {currentSectionTitle || "视频分P"}
          </span>
          <span className="text-xs text-zinc-500 ml-auto">
            {currentTree.length} 个视频
          </span>
        </div>
        <Table<RowData>
          rowKey="key"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={currentTree}
          expandable={{ defaultExpandAllRows: true }}
        />
      </div>

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
            请确认或修改下载根目录下的相对子目录：
          </label>
          <Input
            value={dirValue}
            onChange={(e) => setDirValue(e.target.value)}
            placeholder="例如：合集标题/分区标题"
          />
          <p className="text-xs text-zinc-500">
            最终文件会保存到服务端下载根目录下的该子目录中。
          </p>
          {!dirValue.trim() && (
            <p className="text-xs text-red-600">目录不能为空</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
