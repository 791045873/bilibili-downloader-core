import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Empty,
  Image as AntImage,
  Input,
  Popconfirm,
  Spin,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  PictureOutlined,
  SendOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createChatConversation,
  deleteChatConversation,
  listChatConversations,
  listChatMessages,
  sendChatMessage,
  uploadChatPhotos,
} from "../api";
import type { ChatConversation, ChatMessage } from "../types";

const PHOTO_MAX_PER_MESSAGE = 3;
const IMAGE_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="100%" height="100%" fill="#f4f4f5"/><text x="50%" y="50%" fill="#a1a1aa" font-size="12" text-anchor="middle" dominant-baseline="middle">图片加载失败</text></svg>`,
  );

function videoLink(url: string | null, timestampSeconds: number | null): string | null {
  if (!url) return null;
  if (timestampSeconds == null) return url;
  return url.includes("?") ? `${url}&t=${timestampSeconds}` : `${url}?t=${timestampSeconds}`;
}

function newLocalMessage(id: number, conversationId: number, role: "user" | "assistant", content: string, photoUrls: string[] = []): ChatMessage {
  return { id, conversationId, role, content, photoUrls };
}

export function Component() {
  const { message: antdMessage } = App.useApp();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const localIdRef = useRef(-1);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const conversationsQuery = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: listChatConversations,
  });
  const conversations: ChatConversation[] = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data],
  );

  useEffect(() => {
    if (activeId == null && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  useEffect(() => {
    if (activeId == null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    void listChatMessages(activeId)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMessages([]);
          antdMessage.error(err instanceof Error ? err.message : "加载会话失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const handleCreate = useCallback(async () => {
    try {
      const res = await createChatConversation();
      await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      setActiveId(res.conversationId);
      setMessages([]);
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : "创建会话失败");
    }
  }, [antdMessage, queryClient]);

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteChatConversation(id);
        await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
        if (activeId === id) {
          setActiveId(null);
          setMessages([]);
        }
        antdMessage.success("会话已删除");
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : "删除会话失败");
      }
    },
    [activeId, antdMessage, queryClient],
  );

  const handlePickPhotos = useCallback((files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).slice(0, PHOTO_MAX_PER_MESSAGE);
    setPendingPhotos((prev) => [...prev, ...picked].slice(0, PHOTO_MAX_PER_MESSAGE));
  }, []);

  const handleSend = useCallback(async () => {
    if (activeId == null || sending) return;
    const content = input.trim();
    if (content === "" && pendingPhotos.length === 0) return;
    setSending(true);
    setInput("");
    const photos = pendingPhotos;
    setPendingPhotos([]);
    const optimisticId = localIdRef.current--;
    setMessages((prev) => [
      ...prev,
      newLocalMessage(optimisticId, activeId, "user", content, photos.map((f) => URL.createObjectURL(f))),
    ]);
    try {
      let photoUrls: string[] = [];
      if (photos.length > 0) {
        const uploadRes = await uploadChatPhotos(activeId, photos);
        photoUrls = uploadRes.photoUrls;
      }
      const res = await sendChatMessage(activeId, content, photoUrls);
      const assistant: ChatMessage = {
        id: res.assistantMessageId ?? localIdRef.current--,
        conversationId: activeId,
        role: "assistant",
        content: res.reply.text,
        photoUrls: [],
        replyImages: res.reply.images,
        replySources: res.reply.sources,
      };
      setMessages((prev) => [
        ...prev.map((m) =>
          m.id === optimisticId ? { ...m, id: res.userMessageId, photoUrls } : m,
        ),
        assistant,
      ]);
      void queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : "发送失败，请重试");
    } finally {
      setSending(false);
    }
  }, [activeId, antdMessage, input, pendingPhotos, queryClient, sending]);

  return (
    <div className="flex gap-4 h-[calc(100vh-7.5rem)]">
      <aside className="w-64 shrink-0 flex flex-col gap-2">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} block>
          新建会话
        </Button>
        <div className="flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {conversationsQuery.isLoading ? (
            <div className="p-4 text-center">
              <Spin />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400 text-center">暂无会话</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                  conv.id === activeId ? "bg-rose-50" : "hover:bg-zinc-50"
                }`}
                onClick={() => setActiveId(conv.id)}
              >
                <span className="flex-1 truncate text-sm" title={conv.title ?? `会话 ${conv.id}`}>
                  {conv.title ?? `会话 ${conv.id}`}
                </span>
                <Popconfirm
                  title="删除会话？"
                  description="删除后不可恢复"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    void handleDelete(conv.id);
                  }}
                  onCancel={(e) => e?.stopPropagation()}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="flex-1 flex flex-col rounded-lg border border-zinc-200 bg-white min-w-0">
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center">
              <Spin />
            </div>
          ) : activeId == null ? (
            <Empty description="选择或新建一个会话开始提问" className="mt-16" />
          ) : messages.length === 0 ? (
            <Empty
              description="问一个穿搭问题，或上传穿搭照片"
              className="mt-16"
            >
              <Typography.Text type="secondary" className="text-sm">
                例如：小个子怎么穿显高？
              </Typography.Text>
            </Empty>
          ) : (
            messages.map((m) => <ChatBubble key={m.id} message={m} />)
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-zinc-100 px-3 py-2">
                <Spin size="small" />
                <span className="ml-2 text-sm text-zinc-500">正在思考…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-zinc-200 p-3 space-y-2">
          {pendingPhotos.length > 0 && (
            <div className="flex gap-2">
              {pendingPhotos.map((f, i) => (
                <span key={`${f.name}-${i}`} className="text-xs text-zinc-500 bg-zinc-100 rounded px-2 py-1">
                  {f.name.slice(0, 16)}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  handlePickPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button icon={<PictureOutlined />} disabled={sending || pendingPhotos.length >= PHOTO_MAX_PER_MESSAGE}>
                照片（{pendingPhotos.length}/{PHOTO_MAX_PER_MESSAGE}）
              </Button>
            </label>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问一个穿搭问题，如：小个子怎么穿显高？"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={sending || activeId == null}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              className="flex-1"
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sending}
              disabled={activeId == null || (input.trim() === "" && pendingPhotos.length === 0)}
              onClick={() => void handleSend()}
            >
              发送
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.photoUrls.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end">
            {message.photoUrls.map((url) => (
              <AntImage
                key={url}
                src={url}
                fallback={IMAGE_FALLBACK}
                width={120}
                className="rounded-lg border border-zinc-200"
              />
            ))}
          </div>
        )}
        {message.content !== "" && (
          <div className="max-w-[70%] rounded-lg bg-rose-500 text-white px-3 py-2 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 max-w-[85%]">
      <div className="md-preview rounded-lg bg-zinc-100 px-4 py-3 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
      {(message.replyImages?.length ?? 0) > 0 && (
        <div className="flex gap-2 flex-wrap">
          {message.replyImages!.map((img) => (
            <div key={img.url} className="w-40">
              <AntImage
                src={img.url}
                fallback={IMAGE_FALLBACK}
                className="rounded-lg border border-zinc-200"
              />
              <div className="text-xs text-zinc-500 mt-1 truncate" title={img.tipTitle}>
                {img.tipTitle}
                {img.caption ? `：${img.caption}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {(message.replySources?.length ?? 0) > 0 && (
        <div className="w-full border-t border-zinc-100 pt-2 space-y-1">
          <div className="text-xs text-zinc-400">来源视频</div>
          {message.replySources!.map((src, i) => {
            const link = videoLink(src.videoUrl, src.timestampSeconds);
            return (
              <div key={`${src.tipTitle}-${i}`} className="text-xs text-zinc-500">
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="text-rose-600 hover:underline">
                    {src.videoTitle}
                    {src.timestampSeconds != null ? ` · ${formatTs(src.timestampSeconds)}` : ""}
                  </a>
                ) : (
                  <span>{src.videoTitle}</span>
                )}
                <span className="mx-1 text-zinc-300">|</span>
                <span>{src.tipTitle}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTs(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
