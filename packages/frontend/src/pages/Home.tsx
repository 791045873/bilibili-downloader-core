import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Input } from "antd";

export function Component() {
  const navigate = useNavigate();
  const [inputText, setInputText] = useState("");

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
