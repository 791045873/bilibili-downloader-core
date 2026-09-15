import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Button, Image, Result, Spin } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSummaryMarkdownByResource } from "../api";

function formatMetaTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function Component() {
  const { bvid, cid } = useParams<{ bvid: string; cid: string }>();
  const parsedCid = cid != null && /^\d+$/.test(cid) ? Number(cid) : null;
  const enabled = Boolean(bvid) && parsedCid != null;

  const query = useQuery({
    queryKey: ["summary-by-resource", bvid, parsedCid],
    queryFn: () => getSummaryMarkdownByResource(bvid as string, parsedCid as number),
    enabled,
    retry: false,
  });

  const error = !enabled
    ? new Error("无效的视频资源标识")
    : query.isError
      ? (query.error as Error)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link to="/qa">
          <Button icon={<ArrowLeftOutlined />}>返回问答</Button>
        </Link>
        <h1 className="truncate text-base font-semibold text-zinc-900">
          AI 总结
        </h1>
      </div>

      {query.isLoading && (
        <div className="flex h-60 items-center justify-center">
          <Spin />
        </div>
      )}

      {!query.isLoading && error && (
        <Result
          status="error"
          title="无法查看 AI 总结"
          subTitle={error.message}
          extra={
            <Link to="/qa">
              <Button type="primary">返回问答</Button>
            </Link>
          }
        />
      )}

      {!query.isLoading && !error && query.data && (
        <>
          {(query.data.meta.videoUrl ||
            query.data.meta.model ||
            query.data.meta.createdAt) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
              {query.data.meta.videoUrl && (
                <a
                  href={query.data.meta.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  B站原视频
                </a>
              )}
              {query.data.meta.model && <span>模型：{query.data.meta.model}</span>}
              {query.data.meta.createdAt && (
                <span>生成于 {formatMetaTime(query.data.meta.createdAt)}</span>
              )}
            </div>
          )}
          <div className="md-preview overflow-auto rounded-lg border border-zinc-200 bg-white p-5 text-sm leading-relaxed text-zinc-800">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ node: _node, ...rest }) => (
                  <Image
                    src={rest.src}
                    alt={rest.alt}
                    className="my-3 rounded-lg border border-zinc-200"
                    style={{
                      maxHeight: 320,
                      maxWidth: "100%",
                      objectFit: "contain",
                    }}
                    preview={{ mask: "点击查看大图" }}
                  />
                ),
              }}
            >
              {query.data.content}
            </ReactMarkdown>
          </div>
        </>
      )}
    </div>
  );
}
