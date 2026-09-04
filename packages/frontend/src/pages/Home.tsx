import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Input } from "antd";
import {
  useParseHistoryStore,
  type ParseHistoryEntry,
} from "../stores/parseHistory";

const TYPE_LABELS: Record<ParseHistoryEntry["type"], string> = {
  video: "视频",
  "ugc-season": "合集",
  favorites: "收藏夹",
  "user-videos": "UP主",
};

function coverSrc(url?: string): string {
  if (!url) return "";
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

export function Component() {
  const navigate = useNavigate();
  const [inputText, setInputText] = useState("");
  const entries = useParseHistoryStore((s) => s.entries);
  const removeEntry = useParseHistoryStore((s) => s.remove);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const input = inputText.trim();
    if (!input) return;
    navigate(`/parse-result?input=${encodeURIComponent(input)}`);
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-rose-600 mb-4">
          输入 Bilibili 链接
        </h2>
        <form className="flex gap-3" onSubmit={handleSubmit}>
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="BV号 / 视频链接 / 用户空间 / 合集 / 收藏夹链接..."
            className="flex-1"
            size="large"
            autoFocus
          />
          <Button
            type="primary"
            size="large"
            htmlType="submit"
            disabled={!inputText.trim()}
          >
            解析视频
          </Button>
        </form>
      </div>

      {entries.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-zinc-900 mb-4">
            最近解析
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((entry) => (
              <div
                key={entry.key}
                className="group relative flex gap-3 rounded-lg border border-zinc-200 p-3 cursor-pointer hover:border-rose-500/50 transition-colors"
                onClick={() => {
                  const query = new URLSearchParams(entry.params).toString();
                  navigate(`/parse-result/list?${query}`);
                }}
              >
                {entry.coverUrl ? (
                  <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-zinc-100">
                    <img
                      src={coverSrc(entry.coverUrl)}
                      alt={entry.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-400">
                    <span className="text-xs">无封面</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                      {TYPE_LABELS[entry.type]}
                    </span>
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {entry.title}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {relativeTime(entry.parsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="删除卡片"
                  className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-500 hover:bg-rose-100 hover:text-rose-600 group-hover:flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEntry(entry.key);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          className="rounded-lg border border-zinc-200 bg-white p-5 text-left hover:border-rose-500/50 transition-colors"
          onClick={() => navigate("/downloading")}
        >
          <div className="text-2xl mb-2">📥</div>
          <div className="font-medium text-zinc-900">下载队列</div>
          <div className="text-sm text-zinc-500 mt-1">查看/管理下载任务</div>
        </button>
        <button
          type="button"
          className="rounded-lg border border-zinc-200 bg-white p-5 text-left hover:border-rose-500/50 transition-colors"
          onClick={() => navigate("/settings")}
        >
          <div className="text-2xl mb-2">⚙️</div>
          <div className="font-medium text-zinc-900">设置</div>
          <div className="text-sm text-zinc-500 mt-1">默认画质、编码偏好</div>
        </button>
      </div>
    </div>
  );
}
