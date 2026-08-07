<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { parseLink } from "../api";
import type {
  ParseLinkResult,
  UserSpaceResult,
  UgcSeasonSummary,
  VideoSummary,
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

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref("");
const parsedResult = ref<ParseLinkResult | null>(null);
const userSpace = ref<UserSpaceResult | null>(null);
const groups = ref<GroupEntry[]>([]);

const input = computed(() => {
  const raw = route.query.input;
  return typeof raw === "string" ? raw.trim() : "";
});

function toUserGroups(result: UserSpaceResult): GroupEntry[] {
  const userVideoThumbs = result.videos.items
    .map((v) => v.cover)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 4);

  const seasonGroups = result.seasons.map((season: UgcSeasonSummary) => ({
    key: `season-${season.seasonId}`,
    title: season.title,
    thumbnails: season.cover ? [season.cover, season.cover, season.cover, season.cover] : [],
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

async function load() {
  loading.value = true;
  error.value = "";
  parsedResult.value = null;
  userSpace.value = null;
  groups.value = [];

  if (!input.value) {
    error.value = "输入不能为空";
    loading.value = false;
    return;
  }

  try {
    const result = await parseLink(input.value);
    parsedResult.value = result;

    if (result.type === "user-space") {
      const data = result.data as UserSpaceResult;
      userSpace.value = data;
      groups.value = toUserGroups(data);
      return;
    }

    if (result.type === "ugc-season") {
      const data = result.data as { seasonId: number };
      await router.replace({
        name: "parse-result-list",
        query: {
          type: "ugc-season",
          seasonId: String(data.seasonId),
        },
      });
      return;
    }

    if (result.type === "favorites") {
      const data = result.data as { mediaId: number };
      await router.replace({
        name: "parse-result-list",
        query: {
          type: "favorites",
          mediaId: String(data.mediaId),
        },
      });
      return;
    }

    const seasonId = toSeasonIdFromVideo(result);
    const videoData = result.data as { bvid: string };
    if (seasonId !== undefined) {
      await router.replace({
        name: "parse-result-list",
        query: {
          type: "ugc-season",
          seasonId: String(seasonId),
          currentBvid: videoData.bvid,
        },
      });
      return;
    }

    await router.replace({
      name: "parse-result-list",
      query: {
        type: "video",
        bvid: videoData.bvid,
      },
    });
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "解析失败";
  } finally {
    loading.value = false;
  }
}

function enterGroup(group: GroupEntry) {
  if (group.target.type === "user-videos" && group.target.mid) {
    router.push({
      name: "parse-result-list",
      query: {
        type: "user-videos",
        mid: String(group.target.mid),
      },
    });
    return;
  }

  if (group.target.type === "ugc-season" && group.target.seasonId) {
    router.push({
      name: "parse-result-list",
      query: {
        type: "ugc-season",
        seasonId: String(group.target.seasonId),
      },
    });
  }
}

function imageSrc(url: string): string {
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg border border-zinc-200 bg-white p-4">
      <p class="text-xs text-zinc-500">当前输入</p>
      <p class="text-sm text-zinc-800 break-all">{{ input }}</p>
    </div>

    <div v-if="loading" class="rounded-lg border border-zinc-200 bg-white p-8 text-center text-zinc-500">
      正在解析链接...
    </div>

    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 p-6">
      <p class="text-red-600 text-sm">{{ error }}</p>
      <button class="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-100" @click="router.push('/')">
        返回首页
      </button>
    </div>

    <template v-else-if="userSpace">
      <div class="rounded-lg border border-zinc-200 bg-white p-5 flex items-center gap-4">
        <img
          v-if="userSpace.face"
          :src="imageSrc(userSpace.face)"
          :alt="userSpace.name"
          class="h-14 w-14 rounded-full border border-zinc-300 object-cover"
        />
        <div>
          <p class="text-xs text-zinc-500">用户空间</p>
          <p class="text-lg font-semibold text-zinc-900">{{ userSpace.name }}</p>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div
          v-for="group in groups"
          :key="group.key"
          class="rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-900">{{ group.title }}</h3>
            <button
              class="rounded-md bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-500"
              @click="enterGroup(group)"
            >
              进入
            </button>
          </div>
          <div class="mt-3 grid grid-cols-4 gap-2">
            <div
              v-for="(thumb, idx) in group.thumbnails"
              :key="`${group.key}-${idx}`"
              class="h-14 overflow-hidden rounded bg-zinc-100"
            >
              <img :src="imageSrc(thumb)" alt="thumb" class="h-full w-full object-cover" />
            </div>
            <div
              v-for="idx in Math.max(0, 4 - group.thumbnails.length)"
              :key="`${group.key}-placeholder-${idx}`"
              class="h-14 rounded bg-zinc-100/60"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
