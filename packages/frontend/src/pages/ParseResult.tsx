import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import * as api from "../api";
import type {
  ParseLinkResult,
  UserSpaceResult,
  UgcSeasonSummary,
} from "../types";

interface GroupEntry {
  key: string;
  title: string;
  thumbnails: string[];
  target: {
    type: "user-videos" | "ugc-season";
    mid?: number;
    seasonId?: number;
  };
}

function imageSrc(url: string): string {
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

function toUserGroups(result: UserSpaceResult): GroupEntry[] {
  const userVideoThumbs = result.videos.items
    .map((v) => v.cover)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 4);

  const seasonGroups = result.seasons.map((season: UgcSeasonSummary) => ({
    key: `season-${season.seasonId}`,
    title: season.title,
    thumbnails: season.cover
      ? [season.cover, season.cover, season.cover, season.cover]
      : [],
    target: {
      type: "ugc-season" as const,
      seasonId: season.seasonId,
    },
  }));

  return [
    {
      key: "user-videos",
      title: "投稿视频",
      thumbnails: userVideoThumbs,
      target: {
        type: "user-videos",
        mid: result.mid,
      },
    },
    ...seasonGroups,
  ];
}

function toSeasonIdFromVideo(result: ParseLinkResult): number | undefined {
  if (result.type !== "video") return undefined;
  const videoData = result.data as { ugcSeason?: { seasonId: number } };
  return videoData.ugcSeason?.seasonId;
}

export function Component() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const input = (searchParams.get("input") ?? "").trim();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["parse-link", input],
    queryFn: () => api.parseLink(input),
    enabled: input.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    if (data.type === "user-space") return;

    if (data.type === "ugc-season") {
      const seasonData = data.data as { seasonId: number };
      void navigate(
        `/parse-result/list?type=ugc-season&seasonId=${seasonData.seasonId}`,
        { replace: true },
      );
      return;
    }

    if (data.type === "favorites") {
      const favData = data.data as { mediaId: number };
      void navigate(
        `/parse-result/list?type=favorites&mediaId=${favData.mediaId}`,
        { replace: true },
      );
      return;
    }

    const seasonId = toSeasonIdFromVideo(data);
    const videoData = data.data as { bvid: string };
    if (seasonId !== undefined) {
      void navigate(
        `/parse-result/list?type=ugc-season&seasonId=${seasonId}&currentBvid=${videoData.bvid}`,
        { replace: true },
      );
      return;
    }

    void navigate(`/parse-result/list?type=video&bvid=${videoData.bvid}`, {
      replace: true,
    });
  }, [data, navigate]);

  const userSpace = useMemo(
    () =>
      data?.type === "user-space" ? (data.data as UserSpaceResult) : null,
    [data],
  );
  const groups = useMemo(
    () => (userSpace ? toUserGroups(userSpace) : []),
    [userSpace],
  );

  const emptyInput = input.length === 0;
  const errorMessage = isError
    ? error instanceof Error
      ? error.message
      : "解析失败"
    : emptyInput
      ? "输入不能为空"
      : "";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-xs text-zinc-500">当前输入</p>
        <p className="text-sm text-zinc-800 break-all">{input}</p>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-zinc-500">
          正在解析链接...
        </div>
      )}

      {(emptyInput || isError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-red-600 text-sm">{errorMessage}</p>
          <button
            type="button"
            className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
            onClick={() => navigate("/")}
          >
            返回首页
          </button>
        </div>
      )}

      {userSpace && (
        <>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 flex items-center gap-4">
            {userSpace.face && (
              <img
                src={imageSrc(userSpace.face)}
                alt={userSpace.name}
                className="h-14 w-14 rounded-full border border-zinc-300 object-cover"
              />
            )}
            <div>
              <p className="text-xs text-zinc-500">用户空间</p>
              <p className="text-lg font-semibold text-zinc-900">
                {userSpace.name}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <div
                key={group.key}
                className="rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {group.title}
                  </h3>
                  <button
                    type="button"
                    className="rounded-md bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-500"
                    onClick={() => {
                      if (
                        group.target.type === "user-videos" &&
                        group.target.mid
                      ) {
                        navigate(
                          `/parse-result/list?type=user-videos&mid=${group.target.mid}`,
                        );
                      } else if (
                        group.target.type === "ugc-season" &&
                        group.target.seasonId
                      ) {
                        navigate(
                          `/parse-result/list?type=ugc-season&seasonId=${group.target.seasonId}`,
                        );
                      }
                    }}
                  >
                    进入
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {group.thumbnails.map((thumb, idx) => (
                    <div
                      key={`${group.key}-${idx}`}
                      className="h-14 overflow-hidden rounded bg-zinc-100"
                    >
                      <img
                        src={imageSrc(thumb)}
                        alt="thumb"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                  {Array.from(
                    { length: Math.max(0, 4 - group.thumbnails.length) },
                    (_, idx) => (
                      <div
                        key={`${group.key}-placeholder-${idx}`}
                        className="h-14 rounded bg-zinc-100/60"
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
