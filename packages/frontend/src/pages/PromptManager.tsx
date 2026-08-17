import { useRef, useState, type ComponentRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Table, Tag } from "antd";
import type { TableProps } from "antd";
import * as api from "../api";
import type { AiPrompt } from "../types";

function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function Component() {
  const queryClient = useQueryClient();

  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AiPrompt | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [snippet, setSnippet] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewingPrompt, setViewingPrompt] = useState<AiPrompt | null>(null);

  const contentRef = useRef<ComponentRef<typeof Input.TextArea> | null>(null);

  const promptsQuery = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.getPrompts(),
  });

  const prompts = promptsQuery.data?.items ?? [];
  const loading = promptsQuery.isLoading;

  function openCreate() {
    setEditing(null);
    setName("");
    setContent("");
    setError("");
    setEditorOpen(true);
    void api
      .getPromptFormatSnippet()
      .then((r) => setSnippet(r.snippet))
      .catch(() => setSnippet(""));
  }

  function openEdit(prompt: AiPrompt) {
    setEditing(prompt);
    setName(prompt.name);
    setContent(prompt.content);
    setError("");
    setEditorOpen(true);
    void api
      .getPromptFormatSnippet()
      .then((r) => setSnippet(r.snippet))
      .catch(() => setSnippet(""));
  }

  function insertFormatSnippet() {
    if (!snippet) {
      setError("无法获取格式要求片段，请稍后重试");
      return;
    }
    const el = contentRef.current?.resizableTextArea?.textArea ?? null;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? content.length;
    const next = content.slice(0, start) + snippet + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      if (el) {
        const cursor = start + snippet.length;
        el.focus();
        el.setSelectionRange(cursor, cursor);
      }
    });
  }

  async function handleSave() {
    setError("");
    if (!name.trim() || !content.trim()) {
      setError("名称与内容均不能为空");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updatePrompt(editing.id, {
          name: name.trim(),
          content,
        });
      } else {
        await api.createPrompt({ name: name.trim(), content });
      }
      setEditorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(prompt: AiPrompt) {
    setError("");
    Modal.confirm({
      title: "删除提示词",
      content: `确认删除提示词「${prompt.name}」？删除后不可恢复。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.deletePrompt(prompt.id);
          await queryClient.invalidateQueries({ queryKey: ["prompts"] });
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "删除失败");
        }
      },
    });
  }

  async function handleSetDefault(prompt: AiPrompt) {
    setError("");
    try {
      await api.setDefaultPrompt(prompt.id);
      await queryClient.invalidateQueries({ queryKey: ["prompts"] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "设为默认失败");
    }
  }

  const columns: TableProps<AiPrompt>["columns"] = [
    {
      title: "名称",
      width: 240,
      render: (_, prompt) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900">{prompt.name}</span>
          {prompt.isSystem === 1 && <Tag color="blue">系统内置</Tag>}
          {prompt.isDefault === 1 && <Tag color="green">默认</Tag>}
        </div>
      ),
    },
    {
      title: "内容",
      width: 320,
      render: (_, prompt) => (
        <button
          type="button"
          title="点击查看完整内容"
          className="block w-full text-left"
          onClick={() => setViewingPrompt(prompt)}
        >
          <span className="block max-w-[300px] truncate text-xs text-zinc-600 hover:text-blue-600 hover:underline">
            {prompt.content}
          </span>
        </button>
      ),
    },
    {
      title: "创建时间",
      width: 130,
      render: (_, prompt) => (
        <span className="whitespace-nowrap text-zinc-400">
          {formatTime(prompt.createdAt)}
        </span>
      ),
    },
    {
      title: "操作",
      width: 260,
      render: (_, prompt) => {
        const isSystem = prompt.isSystem === 1;
        return (
          <div className="flex items-center gap-2">
            <Button
              size="small"
              disabled={isSystem || prompt.isDefault === 1}
              onClick={() => void handleSetDefault(prompt)}
            >
              设为默认
            </Button>
            <Button
              size="small"
              disabled={isSystem}
              onClick={() => openEdit(prompt)}
            >
              编辑
            </Button>
            <Button
              size="small"
              color="red"
              variant="outlined"
              disabled={isSystem}
              onClick={() => void handleDelete(prompt)}
            >
              删除
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">AI 提示词</h1>
          <p className="mt-1 text-sm text-zinc-600">
            系统内置提示词不可编辑/删除；删除默认提示词后默认自动回落到内置提示词。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建提示词
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center text-zinc-500">
          加载中...
        </div>
      )}

      {!loading && prompts.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center text-zinc-500">
          暂无提示词
        </div>
      )}

      {prompts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <Table<AiPrompt>
            rowKey="id"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={prompts}
          />
        </div>
      )}

      <Modal
        open={viewingPrompt !== null}
        title={viewingPrompt?.name || "提示词内容"}
        width={720}
        footer={null}
        onCancel={() => setViewingPrompt(null)}
      >
        {viewingPrompt && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {viewingPrompt.isSystem === 1 && <Tag color="blue">系统内置</Tag>}
              {viewingPrompt.isDefault === 1 && <Tag color="green">默认</Tag>}
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800">
              {viewingPrompt.content}
            </pre>
          </div>
        )}
      </Modal>

      <Modal
        open={editorOpen}
        title={editing ? "编辑提示词" : "新建提示词"}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={720}
        onOk={() => void handleSave()}
        onCancel={() => setEditorOpen(false)}
      >
        <div className="flex flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          <label className="text-sm text-zinc-600">名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：穿搭技巧（简洁版）"
            disabled={editing?.isSystem === 1}
          />
          <label className="text-sm text-zinc-600">内容</label>
          <Input.TextArea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="填写 AI 分析指令，可点击下方按钮插入 JSON 格式要求"
            autoSize={{ minRows: 10, maxRows: 18 }}
            disabled={editing?.isSystem === 1}
          />
          <div className="flex items-center gap-2">
            <Button size="small" onClick={insertFormatSnippet}>
              插入格式要求
            </Button>
            {snippet && (
              <span className="text-xs text-zinc-400">
                将 JSON 结构 + 时间戳约束插入光标位置
              </span>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}