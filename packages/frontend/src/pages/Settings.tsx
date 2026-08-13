import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Select, Switch } from "antd";
import * as api from "../api";
import { useSettingsStore } from "../stores/settings";

const qualityOptions = [
  { label: "4K 超清", value: 120 },
  { label: "1080P 高清", value: 80 },
  { label: "720P 高清", value: 64 },
  { label: "480P 清晰", value: 32 },
  { label: "360P 流畅", value: 16 },
];

const codecOptions = [
  { label: "自动", value: "" },
  { label: "AVC (H.264)", value: "AVC" },
  { label: "HEVC (H.265)", value: "HEVC" },
  { label: "AV1", value: "AV1" },
];

const audioQualityOptions = [
  { label: "192K", value: "192K" },
  { label: "128K", value: "128K" },
  { label: "64K", value: "64K" },
];

export function Component() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const { data: downloadConfig, error: downloadConfigError } = useQuery({
    queryKey: ["download-config"],
    queryFn: () => api.getDownloadConfig(),
    retry: false,
  });

  function handleSave() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  async function copyOutputDir() {
    if (!downloadConfig?.outputDir) return;
    try {
      await navigator.clipboard.writeText(downloadConfig.outputDir);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-rose-600 mb-6">下载设置</h2>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            下载目录
          </h3>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
            {downloadConfig ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-700">
                    服务端下载根目录
                  </span>
                  <span className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600">
                    {downloadConfig.source === "env" ? "环境变量" : "默认目录"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
                    {downloadConfig.outputDir}
                  </code>
                  <Button size="small" onClick={() => void copyOutputDir()}>
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
                {copyError && (
                  <p className="text-xs text-amber-600">
                    复制失败，请手动选择路径文本。
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  入队时填写的是该目录下的相对子目录。
                </p>
              </div>
            ) : downloadConfigError ? (
              <p className="text-sm text-red-600">
                {downloadConfigError instanceof Error
                  ? downloadConfigError.message
                  : "读取下载目录失败"}
              </p>
            ) : (
              <p className="text-sm text-zinc-500">正在读取下载目录...</p>
            )}
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            自动操作
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">自动解析视频</span>
              <Switch
                checked={settings.autoParse}
                onChange={(v) => update({ autoParse: v })}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">解析后自动下载</span>
              <Switch
                checked={settings.autoDownload}
                onChange={(v) => update({ autoDownload: v })}
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            默认画质偏好
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">视频画质</span>
              <Select
                value={settings.defaultQuality}
                options={qualityOptions}
                onChange={(v) => update({ defaultQuality: v })}
                style={{ width: 160 }}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">视频编码</span>
              <Select
                value={settings.defaultCodec}
                options={codecOptions}
                onChange={(v) => update({ defaultCodec: v })}
                style={{ width: 160 }}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">音频质量</span>
              <Select
                value={settings.defaultAudioQuality}
                options={audioQualityOptions}
                onChange={(v) => update({ defaultAudioQuality: v })}
                style={{ width: 160 }}
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            文件名模板
          </h3>
          <div className="space-y-2">
            <Input
              value={settings.defaultFileNameTemplate}
              onChange={(e) =>
                update({ defaultFileNameTemplate: e.target.value })
              }
              placeholder="{title}-{bvid}-{cid}-q{quality}"
            />
            <p className="text-xs text-zinc-500">
              占位符：{"{title}"} {"{bvid}"} {"{cid}"} {"{quality}"} {"{codec}"}
              。留空使用默认模板，包含 bvid/cid/quality
              以保证同名视频不冲突。
            </p>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            附加内容
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">下载弹幕</span>
              <Switch
                checked={settings.downloadDanmaku}
                onChange={(v) => update({ downloadDanmaku: v })}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-zinc-700">下载字幕</span>
              <Switch
                checked={settings.downloadSubtitle}
                onChange={(v) => update({ downloadSubtitle: v })}
              />
            </div>
          </div>
        </div>

        <Button type="primary" onClick={handleSave}>
          {saved ? "已保存 ✓" : "保存设置"}
        </Button>
      </div>
    </div>
  );
}
