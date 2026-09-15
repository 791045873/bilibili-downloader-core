import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Drawer,
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
  UnorderedListOutlined,
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
import type { ChatConversation, ChatMessage, ChatReplyImage } from "../types";

const PHOTO_MAX_PER_MESSAGE = 3;
const IMAGE_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="100%" height="100%" fill="#f4f4f5"/><text x="50%" y="50%" fill="#a1a1aa" font-size="12" text-anchor="middle" dominant-baseline="middle">图片加载失败</text></svg>`,
  );
const MOBILE_QUERY = "(max-width: 767.98px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const SWIPE_THRESHOLD_PX = 50;
const CHAT_HEIGHT =
  "calc(var(--vvh, 100dvh) - var(--app-header-h, 3.5rem) - 3rem)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function videoLink(url: string | null, timestampSeconds: number | null): string | null {
  if (!url) return null;
  if (timestampSeconds == null) return url;
  return url.includes("?") ? `${url}&t=${timestampSeconds}` : `${url}?t=${timestampSeconds}`;
}

function newLocalMessage(id: number, conversationId: number, role: "user" | "assistant", content: string, photoUrls: string[] = []): ChatMessage {
  return { id, conversationId, role, content, photoUrls };
}

function replyImageCaption(images: ChatReplyImage[] | null, index: number): string {
  const image = images?.[index];
  if (!image) return "";
  return image.caption ? `${image.tipTitle}：${image.caption}` : image.tipTitle;
}

export function Component() {
  const { message: antdMessage } = App.useApp();
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [gallery, setGallery] = useState<ChatReplyImage[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const localIdRef = useRef(-1);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);

  const conversationsQuery = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: listChatConversations,
  });
  const conversations: ChatConversation[] = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data],
  );
  const activeConversation = conversations.find((item) => item.id === activeId);
  const galleryItems = useMemo(
    () => (gallery ?? []).map((image) => ({ src: image.url, alt: image.tipTitle })),
    [gallery],
  );
  const galleryOpen = gallery !== null && gallery.length > 0;

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
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  useEffect(() => {
    scaleRef.current = 1;
    setGallery(null);
    setGalleryIndex(0);
  }, [activeId]);

  useEffect(() => {
    if (!galleryOpen) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const handleStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const handleEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (scaleRef.current > 1) return;
      setGalleryIndex((current) => {
        const total = gallery?.length ?? 0;
        const next = dx < 0 ? current + 1 : current - 1;
        if (next < 0 || next >= total) return current;
        return next;
      });
    };
    document.addEventListener("touchstart", handleStart, { capture: true, passive: true });
    document.addEventListener("touchend", handleEnd, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", handleStart, { capture: true });
      document.removeEventListener("touchend", handleEnd, { capture: true });
    };
  }, [galleryOpen, gallery]);

  const openGallery = useCallback((images: ChatReplyImage[], index: number) => {
    scaleRef.current = 1;
    setGallery(images);
    setGalleryIndex(index);
  }, []);

  const closeGallery = useCallback(() => {
    scaleRef.current = 1;
    setGallery(null);
    setGalleryIndex(0);
  }, []);

  const handleSelectConversation = useCallback((id: number) => {
    setActiveId(id);
    setListOpen(false);
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const res = await createChatConversation();
      await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      setActiveId(res.conversationId);
      setMessages([]);
      setListOpen(false);
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
    <div className="flex flex-col gap-3" style={{ height: CHAT_HEIGHT }}>
      <AntImage.PreviewGroup
        items={galleryItems}
        fallback={IMAGE_FALLBACK}
        preview={{
          open: galleryOpen,
          current: galleryIndex,
          onOpenChange: (open) => {
            if (!open) closeGallery();
          },
          onChange: (current) => setGalleryIndex(current),
          onTransform: (info) => {
            scaleRef.current = info.transform.scale;
          },
          imageRender: (node, info) => (
            <div className="flex flex-col items-center gap-2">
              {node}
              <div className="max-w-[90vw] px-4 text-center text-sm text-white/90">
                {replyImageCaption(gallery, info.current)}
              </div>
            </div>
          ),
        }}
      />

      {isMobile && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            icon={<UnorderedListOutlined />}
            onClick={() => setListOpen(true)}
            aria-label="会话列表"
          >
            会话列表
          </Button>
          <span className="truncate text-sm text-zinc-500">
            {activeConversation?.title ?? (activeId != null ? `会话 ${activeId}` : "尚无会话")}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4">
        {!isMobile && (
          <aside className="w-64 shrink-0 flex flex-col gap-2">
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} block>
              新建会话
            </Button>
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              loading={conversationsQuery.isLoading}
              onSelect={setActiveId}
              onDelete={(id) => void handleDelete(id)}
            />
          </aside>
        )}

        <section className="flex-1 min-w-0 flex flex-col rounded-lg border border-zinc-200 bg-white">
          <div ref={messagesRef} className="flex-1 overflow-auto p-4 space-y-4">
            {loadingMessages ? (
              <div className="h-full flex items-center justify-center">
                <Spin />
              </div>
            ) : activeId == null ? (
              <Empty description="选择或新建一个会话开始提问" className="mt-16" />
            ) : messages.length === 0 ? (
              <Empty description="问一个穿搭问题，或上传穿搭照片" className="mt-16">
                <Typography.Text type="secondary" className="text-sm">
                  例如：小个子怎么穿显高？
                </Typography.Text>
              </Empty>
            ) : (
              messages.map((m) => (
                <ChatBubble key={m.id} message={m} onOpenImages={openGallery} />
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-zinc-100 px-3 py-2">
                  <Spin size="small" />
                  <span className="ml-2 text-sm text-zinc-500">正在思考…</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 p-3 pb-safe space-y-2">
            {pendingPhotos.length > 0 && (
              <div className="flex flex-wrap gap-2">
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
                <Button
                  icon={<PictureOutlined />}
                  disabled={sending || pendingPhotos.length >= PHOTO_MAX_PER_MESSAGE}
                  aria-label="选择照片"
                >
                  {isMobile ? null : `照片（${pendingPhotos.length}/${PHOTO_MAX_PER_MESSAGE}）`}
                </Button>
              </label>
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="问一个穿搭问题，如：小个子怎么穿显高？"
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={sending || activeId == null}
                onPressEnter={(e) => {
                  if (coarsePointer) return;
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
                aria-label="发送"
                onClick={() => void handleSend()}
              >
                {isMobile ? null : "发送"}
              </Button>
            </div>
          </div>
        </section>
      </div>

      {isMobile && (
        <Drawer
          open={listOpen}
          onClose={() => setListOpen(false)}
          placement="left"
          width={280}
          title="会话"
        >
          <div className="flex h-full flex-col gap-2">
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} block>
              新建会话
            </Button>
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              loading={conversationsQuery.isLoading}
              onSelect={handleSelectConversation}
              onDelete={(id) => void handleDelete(id)}
            />
          </div>
        </Drawer>
      )}
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  loading,
  onSelect,
  onDelete,
}: {
  conversations: ChatConversation[];
  activeId: number | null;
  loading: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-4 text-center">
        <Spin />
      </div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-4 text-center text-sm text-zinc-400">
        暂无会话
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
            conv.id === activeId ? "bg-rose-50" : "hover:bg-zinc-50"
          }`}
          onClick={() => onSelect(conv.id)}
        >
          <span className="flex-1 truncate text-sm" title={conv.title ?? `会话 ${conv.id}`}>
            {conv.title ?? `会话 ${conv.id}`}
          </span>
          <Popconfirm
            title="删除会话？"
            description="删除后不可恢复"
            onConfirm={(e) => {
              e?.stopPropagation();
              onDelete(conv.id);
            }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="删除会话"
              style={{ width: 44, height: 44 }}
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        </div>
      ))}
    </div>
  );
}

function ChatBubble({
  message,
  onOpenImages,
}: {
  message: ChatMessage;
  onOpenImages: (images: ChatReplyImage[], index: number) => void;
}) {
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
        <div className="flex flex-wrap gap-2">
          {message.replyImages!.map((img, index) => (
            <button
              key={`${img.url}-${index}`}
              type="button"
              onClick={() => onOpenImages(message.replyImages!, index)}
              aria-label={`查看示例图 ${index + 1}`}
              className="overflow-hidden rounded-lg border border-zinc-200 transition-opacity hover:opacity-90"
            >
              <img
                src={img.url}
                alt={img.tipTitle}
                loading="lazy"
                className="h-20 w-20 object-cover"
                onError={(event) => {
                  event.currentTarget.src = IMAGE_FALLBACK;
                }}
              />
            </button>
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
                {src.bvid && src.cid != null && (
                  <>
                    <span className="mx-1 text-zinc-300">|</span>
                    <Link
                      to={`/summary/${encodeURIComponent(src.bvid)}/${src.cid}`}
                      className="text-rose-600 hover:underline"
                    >
                      AI 总结
                    </Link>
                  </>
                )}
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
