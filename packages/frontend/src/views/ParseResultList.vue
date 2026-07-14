<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  checkTasks,
  createDownload,
  getFavoritesVideos,
  getUserSpaceVideos,
  getUgcSeasonVideos,
  parseLink,
  setAutoSummary,
  triggerAiSummary,
} from "../api";
import { useSettingsStore } from "../stores/settings";
import { useDownloadQueueStore } from "../stores/useDownloadQueueStore";
import type { PaginatedVideos, VideoPage, VideoSummary } from "../types";

type ListType = "user-videos" | "ugc-season" | "favorites" | "video";

interface ListItem {
  key: string;
  bvid: string;
  cid: number;
  title: string;
  displayTitle: string;
  cover?: string;
  duration: number;
  groupKey: string;
  groupColorClass: string;
  selected: boolean;
  enqueued: boolean;
  queuedTaskId?: number;
  autoSummaryEnabled: boolean;
  highlighted: boolean;
}

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const queueStore = useDownloadQueueStore();

const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const items = ref<ListItem[]>([]);
const page = ref(1);
const pageSize = 20;
const hasMore = ref(false);
const title = ref("解析结果");

const showDirDialog = ref(false);
const dirDialogValue = ref("");

const currentType = computed<ListType | null>(() => {
  const raw = route.query.type;
  if (raw === "user-videos" || raw === "ugc-season" || raw === "favorites" || raw === "video") {
    return raw;
  }
  return null;
});

const selectedCount = computed(() => items.value.filter((i) => i.selected && !i.enqueued).length);
const canLoadMore = computed(() => hasMore.value && currentType.value !== "video");

const colorPalette = [
  "border-l-rose-500",
  "border-l-sky-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-fuchsia-500",
  "border-l-cyan-500",
];

function groupColorClass(groupKey: string): string {
  let hash = 0;
  for (let i = 0; i < groupKey.length; i++) {
    hash = (hash * 31 + groupKey.charCodeAt(i)) >>> 0;
  }
  return colorPalette[hash % colorPalette.length];
}

function normalizeSinglePage(
  videos: VideoSummary[],
  currentBvid?: string,
): ListItem[] {
  return videos.map((video) => {
    const groupKey = video.bvid;
    return {
      key: `${video.bvid}-${video.cid}`,
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      displayTitle: video.title,
      cover: video.cover,
      duration: video.duration,
      groupKey,
      groupColorClass: groupColorClass(groupKey),
      selected: false,
      enqueued: false,
      autoSummaryEnabled: false,
      highlighted: Boolean(currentBvid && currentBvid === video.bvid),
    };
  });
}

function normalizeVideoPages(
  bvid: string,
  mainTitle: string,
  coverUrl: string,
  pages: VideoPage[],
  highlighted: boolean,
): ListItem[] {
  if (pages.length <= 1) {
    const single = pages[0];
    return [
      {
        key: `${bvid}-${single?.cid ?? 0}`,
        bvid,
        cid: single?.cid ?? 0,
        title: mainTitle,
        displayTitle: mainTitle,
        cover: coverUrl,
        duration: single?.duration ?? 0,
        groupKey: bvid,
        groupColorClass: groupColorClass(bvid),
        selected: false,
        enqueued: false,
        autoSummaryEnabled: false,
        highlighted,
      },
    ];
  }

  return pages.map((pageInfo) => ({
    key: `${bvid}-${pageInfo.cid}`,
    bvid,
    cid: pageInfo.cid,
    title: mainTitle,
    displayTitle: `${mainTitle} P${pageInfo.page}`,
    cover: coverUrl,
    duration: pageInfo.duration,
    groupKey: bvid,
    groupColorClass: groupColorClass(bvid),
    selected: false,
    enqueued: false,
    autoSummaryEnabled: false,
    highlighted,
  }));
}

function imageSrc(url?: string): string {
  if (!url) return "";
  return `/api/video/cover?url=${encodeURIComponent(url)}`;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function fetchList(targetPage: number, append: boolean) {
  const type = currentType.value;
  if (!type) {
    error.value = "缺少列表类型参数";
    return;
  }

  if (!append) {
    loading.value = true;
    error.value = "";
  } else {
    loadingMore.value = true;
  }

  try {
    let normalized: ListItem[] = [];

    if (type === "user-videos") {
      const mid = parsePositiveInt(route.query.mid);
      if (!mid) throw new Error("缺少有效 mid 参数");
      title.value = "投稿视频";
      const result = await getUserSpaceVideos(mid, targetPage, pageSize);
      normalized = normalizeSinglePage(result.items);
      hasMore.value = result.hasMore;
    } else if (type === "ugc-season") {
      const seasonId = parsePositiveInt(route.query.seasonId);
      if (!seasonId) throw new Error("缺少有效 seasonId 参数");
      title.value = "UGC 合集";
      const result = await getUgcSeasonVideos(seasonId, targetPage, pageSize);
      const currentBvid = typeof route.query.currentBvid === "string" ? route.query.currentBvid : undefined;
      normalized = normalizeSinglePage(result.items, currentBvid);
      hasMore.value = result.hasMore;
    } else if (type === "favorites") {
      const mediaId = parsePositiveInt(route.query.mediaId);
      if (!mediaId) throw new Error("缺少有效 mediaId 参数");
      title.value = "收藏夹视频";
      const result = await getFavoritesVideos(mediaId, targetPage, pageSize);
      normalized = normalizeSinglePage(result.items);
      hasMore.value = result.hasMore;
    } else {
      const bvid = typeof route.query.bvid === "string" ? route.query.bvid : "";
      if (!bvid) throw new Error("缺少有效 bvid 参数");
      title.value = "视频分P";

      const parsed = await parseLink(bvid);
      if (parsed.type !== "video") throw new Error("视频解析类型异常");
      const parsedVideo = parsed.data as {
        bvid: string;
        title: string;
        coverUrl: string;
        pages: VideoPage[];
        ugcSeason?: { seasonId: number; sections: Array<{ episodes: Array<{ bvid: string; title: string; pages: VideoPage[] }> }> };
      };

      if (parsedVideo.ugcSeason?.seasonId) {
        const seasonResult = await getUgcSeasonVideos(parsedVideo.ugcSeason.seasonId, 1, 200);
        normalized = normalizeSinglePage(seasonResult.items, parsedVideo.bvid);
        hasMore.value = false;
      } else {
        normalized = normalizeVideoPages(
          parsedVideo.bvid,
          parsedVideo.title,
          parsedVideo.coverUrl,
          parsedVideo.pages,
          false,
        );
        hasMore.value = false;
      }
    }

    if (append) {
      items.value = [...items.value, ...normalized];
    } else {
      items.value = normalized;
    }

    await markEnqueued();
    page.value = targetPage;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function markEnqueued() {
  if (items.value.length === 0) return;
  const response = await checkTasks(
    items.value.map((item) => ({ bvid: item.bvid, cid: item.cid })),
  );
  const itemMap = new Map<string, (typeof response)[number]>(
    response.map((r) => [`${r.bvid}-${r.cid}`, r]),
  );
  items.value = items.value.map((item) => {
    const key = `${item.bvid}-${item.cid}`;
    const task = itemMap.get(key);
    const enqueued = Boolean(task);
    return {
      ...item,
      enqueued,
      queuedTaskId: task?.id,
      autoSummaryEnabled: (task?.autoSummary ?? 0) === 1,
      selected: enqueued ? false : item.selected,
    };
  });
}

function toggleAutoSummary(item: ListItem, checked: boolean) {
  item.autoSummaryEnabled = checked;
}

function toggleSelect(item: ListItem, checked: boolean) {
  if (item.enqueued) return;
  item.selected = checked;
}

function openDirDialog() {
  dirDialogValue.value = "";
  showDirDialog.value = true;
}

async function doAddToQueue(outputPath: string) {
  const selected = items.value.filter((i) => i.selected && !i.enqueued);
  if (selected.length === 0) return;

  try {
    const requests = selected.map((item) =>
      createDownload({
        bvid: item.bvid,
        cid: item.cid,
        title: item.displayTitle,
        quality: settingsStore.settings.defaultQuality,
        codec: settingsStore.settings.defaultCodec,
        subtitleLang: settingsStore.settings.downloadSubtitle ? "zh" : "none",
        outputPath,
        autoSummary: item.autoSummaryEnabled,
      }).catch(() => ({ id: -1, message: "" })),
    );
    const responses = await Promise.all(requests);
    const successIds = responses.filter((r) => r.id !== -1).map((r) => r.id);
    queueStore.addTaskIds(successIds);

    const selectedKeys = new Set(selected.map((i) => i.key));
    items.value = items.value.map((item) => {
      if (!selectedKeys.has(item.key)) return item;
      return {
        ...item,
        enqueued: true,
        selected: false,
      };
    });
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "加入队列失败";
  }
}

async function handleOneClickAiSummary(item: ListItem) {
  if (item.autoSummaryEnabled && item.enqueued) return;

  try {
    if (!item.enqueued) {
      await triggerAiSummary({ bvid: item.bvid, cid: item.cid });
      item.enqueued = true;
      item.autoSummaryEnabled = true;
      await markEnqueued();
      return;
    }

    if (!item.queuedTaskId) {
      await markEnqueued();
    }

    const queuedTaskId = item.queuedTaskId;
    if (!queuedTaskId) {
      throw new Error("无法定位任务 ID");
    }

    if (!item.autoSummaryEnabled) {
      await setAutoSummary(queuedTaskId, true);
      item.autoSummaryEnabled = true;
      await triggerAiSummary({ bvid: item.bvid, cid: item.cid }).catch(() => undefined);
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "AI 总结操作失败";
  }
}

function confirmDirDialog() {
  const value = dirDialogValue.value.trim();
  if (!value) return;
  showDirDialog.value = false;
  doAddToQueue(value);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isNewGroup(index: number): boolean {
  if (index === 0) return true;
  return items.value[index - 1].groupKey !== items.value[index].groupKey;
}

function groupClass(index: number): string {
  const item = items.value[index];
  const spacing = isNewGroup(index) ? "mt-4" : "mt-1";
  const highlight = item.highlighted ? "ring-1 ring-rose-400/70" : "";
  return `${spacing} border-l-4 ${item.groupColorClass} ${highlight}`;
}

function loadMore() {
  if (!canLoadMore.value || loadingMore.value) return;
  fetchList(page.value + 1, true);
}

onMounted(async () => {
  settingsStore.load();
  queueStore.init();
  await fetchList(1, false);
});
</script>

<template>
  <div class="space-y-5">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between gap-4">
      <div>
        <p class="text-xs text-zinc-500">列表类型</p>
        <p class="text-sm font-semibold text-zinc-100">{{ title }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          @click="router.push('/')"
        >
          返回首页
        </button>
        <span class="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300">AI 总结</span>
      </div>
    </div>

    <div v-if="loading" class="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
      正在加载列表...
    </div>

    <div v-else-if="error" class="rounded-lg border border-red-900 bg-red-950/50 p-6 text-sm text-red-400">
      {{ error }}
    </div>

    <template v-else>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between">
        <span class="text-sm text-zinc-400">已选择 {{ selectedCount }} 项</span>
        <button
          class="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500"
          :disabled="selectedCount === 0"
          @click="openDirDialog"
        >
          加入待下载
        </button>
      </div>

      <div>
        <div
          v-for="(item, idx) in items"
          :key="item.key"
          :class="groupClass(idx)"
          class="rounded-r-lg border border-zinc-800 bg-zinc-900 p-3"
        >
          <div class="flex gap-3">
            <input
              type="checkbox"
              class="mt-1"
              :checked="item.selected"
              :disabled="item.enqueued"
              @change="toggleSelect(item, ($event.target as HTMLInputElement).checked)"
            />
            <div v-if="item.cover" class="h-16 w-28 shrink-0 overflow-hidden rounded bg-zinc-800">
              <img :src="imageSrc(item.cover)" :alt="item.title" class="h-full w-full object-cover" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-sm font-medium text-zinc-100">{{ item.displayTitle }}</p>
                <span v-if="item.enqueued" class="text-xs text-green-500">已入队</span>
                <span v-if="item.highlighted" class="text-xs text-rose-400">当前视频</span>
              </div>
              <p class="mt-1 text-xs text-zinc-500">时长：{{ formatDuration(item.duration) }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-1 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    :checked="item.autoSummaryEnabled"
                    @change="toggleAutoSummary(item, ($event.target as HTMLInputElement).checked)"
                  />
                  AI 总结开关
                </label>
                <button
                  class="rounded-md px-2 py-1 text-xs"
                  :class="item.autoSummaryEnabled && item.enqueued ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-rose-600 text-white hover:bg-rose-500'"
                  :disabled="item.autoSummaryEnabled && item.enqueued"
                  @click="handleOneClickAiSummary(item)"
                >
                  一键 AI 总结
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-center">
        <button
          v-if="canLoadMore"
          class="rounded-md border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? "加载中..." : "加载更多" }}
        </button>
      </div>
    </template>

    <Dialog
      v-model:visible="showDirDialog"
      header="确认下载子目录"
      :modal="true"
      :closable="true"
      :style="{ width: '450px' }"
    >
      <div class="flex flex-col gap-3">
        <label class="text-sm text-zinc-400">请确认下载根目录下的相对子目录：</label>
        <InputText v-model="dirDialogValue" class="w-full" placeholder="例如：批量解析/收藏夹" />
        <p v-if="!dirDialogValue.trim()" class="text-xs text-red-400">目录不能为空</p>
      </div>
      <template #footer>
        <Button label="取消" severity="secondary" size="small" @click="showDirDialog = false" />
        <Button
          label="确认"
          severity="success"
          size="small"
          :disabled="!dirDialogValue.trim()"
          @click="confirmDirDialog"
        />
      </template>
    </Dialog>
  </div>
</template>
