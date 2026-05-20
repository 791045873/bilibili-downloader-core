<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import TreeTable from "primevue/treetable";
import Column from "primevue/column";
import Checkbox from "primevue/checkbox";
import Button from "primevue/button";
import Select from "primevue/select";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-vue-next";
import { useSettingsStore } from "../stores/settings";
import { useDownloadQueueStore } from "../stores/useDownloadQueueStore";
import * as api from "../api";
import type { VideoInfo, VideoPage, UgcSection, UgcEpisode } from "../types";

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const queueStore = useDownloadQueueStore();

const loading = ref(true);
const error = ref("");
const videoInfo = ref<VideoInfo | null>(null);

// 展开的 sections
const expandedSections = ref<Record<number, boolean>>({});

// 每个 section 的 TreeTable 节点
interface TreeNode {
  key: string;
  data: {
    type: "episode" | "page";
    episode?: UgcEpisode;
    page?: VideoPage;
    resolved: boolean;
    qualityList?: { id: number; name: string; codecList: string[] }[];
    audioQualityList?: string[];
    selectedQuality?: number;
    selectedCodec?: string;
    selectedAudio?: string;
  };
  children?: TreeNode[];
}

const sectionTrees = ref<Map<number, TreeNode[]>>(new Map());

// 选中的分 P 节点 key 集合（独立 reactive set，确保 v-model 变化被追踪）
const selectedKeys = ref<Set<string>>(new Set());

function isPageSelected(nodeKey: string): boolean {
  return selectedKeys.value.has(nodeKey);
}

function setPageSelected(nodeKey: string, val: boolean) {
  if (val) {
    selectedKeys.value.add(nodeKey);
  } else {
    selectedKeys.value.delete(nodeKey);
  }
  // 重新赋值触发响应式
  selectedKeys.value = new Set(selectedKeys.value);
}

onMounted(async () => {
  await settingsStore.load();
  const input = (route.query.input as string) || "";
  if (!input) { router.replace("/"); return; }
  try {
    const info = await api.getVideoInfo(input);
    videoInfo.value = info;
    if (info.ugcSeason?.sections) {
      // 有合集 → 从 ugcSeason.sections 构建树
      for (const sec of info.ugcSeason.sections) {
        expandedSections.value[sec.id] = true;
        sectionTrees.value.set(sec.id, buildEpisodeTree(sec));
      }
    } else {
      // 无合集 → 构建 mock 树：一个 section，其下唯一的 episode 包含视频的所有分P
      const flatSectionId = -1;
      expandedSections.value[flatSectionId] = true;
      sectionTrees.value.set(flatSectionId, [buildMockVideoNode(info)]);
    }
  } catch (e: any) {
    error.value = e.message || "获取视频信息失败";
  } finally {
    loading.value = false;
  }
});

function buildEpisodeTree(section: UgcSection): TreeNode[] {
  return section.episodes.map((ep) => ({
    key: `${section.id}-${ep.cid}`,
    data: {
      type: "episode" as const,
      episode: ep,
      resolved: false,
    },
    children: ep.pages.map((p) => ({
      key: `${section.id}-${ep.cid}-${p.cid}`,
      data: {
        type: "page" as const,
        page: p,
        resolved: false,
      },
    })),
  }));
}

/** 无合集时构建 mock 树：一个 episode 节点，其 children 为视频的所有分P */
function buildMockVideoNode(info: VideoInfo): TreeNode {
  return {
    key: `video-${info.bvid}`,
    data: {
      type: "episode" as const,
      episode: {
        aid: info.videoInfo.avid,
        bvid: info.bvid,
        cid: info.pages[0]?.cid ?? 0,
        title: info.title,
        pages: info.pages,
      },
      resolved: false,
    },
    children: info.pages.map((p) => ({
      key: `video-${info.bvid}-${p.cid}`,
      data: {
        type: "page" as const,
        page: p,
        resolved: false,
      },
    })),
  };
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

// 选中统计
const allSelectedCount = computed(() => selectedKeys.value.size);

// Section 全选（选择/取消该 section 下所有分 P）
function toggleSection(sectionId: number) {
  const tree = sectionTrees.value.get(sectionId);
  if (!tree) return;
  const allSel = tree.every((ep) =>
    (ep.children ?? []).every((p) => isPageSelected(p.key)),
  );
  tree.forEach((ep) => {
    (ep.children ?? []).forEach((p) => {
      setPageSelected(p.key, !allSel);
    });
  });
}

function sectionSelectState(sectionId: number): boolean | null {
  const tree = sectionTrees.value.get(sectionId);
  if (!tree || tree.length === 0) return false;
  let allPages = 0;
  let selPages = 0;
  tree.forEach((ep) => {
    (ep.children ?? []).forEach((p) => {
      allPages++;
      if (isPageSelected(p.key)) selPages++;
    });
  });
  if (allPages === 0) return false;
  if (selPages === allPages) return true;
  if (selPages === 0) return false;
  return null;
}

// Episode 全选其下所有分 P
function toggleEpisode(node: TreeNode) {
  const pages = node.children ?? [];
  if (pages.length === 0) return;
  const allSel = pages.every((p) => isPageSelected(p.key));
  pages.forEach((p) => { setPageSelected(p.key, !allSel); });
}

function episodeSelectState(node: TreeNode): boolean | null {
  const pages = node.children ?? [];
  if (pages.length === 0) return false;
  const allSel = pages.every((p) => isPageSelected(p.key));
  const noneSel = pages.every((p) => !isPageSelected(p.key));
  return allSel ? true : noneSel ? false : null;
}

// 解析画质（按分 P 解析）
const parsing = ref(false);

async function parseSelected() {
  if (!videoInfo.value) return;
  parsing.value = true;
  try {
    const unresolvedPages: { bvid: string; cid: number }[] = [];
    sectionTrees.value.forEach((tree) => {
      tree.forEach((node) => {
        (node.children ?? []).forEach((p) => {
          if (p.data.type === "page" && isPageSelected(p.key) && !p.data.resolved && p.data.page) {
            unresolvedPages.push({ bvid: videoInfo.value!.bvid, cid: p.data.page.cid });
          }
        });
      });
    });
    if (unresolvedPages.length === 0) return;

    const cids = unresolvedPages.map((e) => e.cid);
    const results = await api.parseAllVideos(videoInfo.value.bvid, cids);
    for (const result of results) {
      sectionTrees.value.forEach((tree) => {
        tree.forEach((node) => {
          (node.children ?? []).forEach((p) => {
            if (p.data.type === "page" && p.data.page?.cid === result.cid) {
              p.data.resolved = true;
              p.data.qualityList = result.videoQualityList;
              p.data.audioQualityList = result.audioQualityList;
              p.data.selectedQuality = result.videoQualityList[0]?.id ?? settingsStore.settings.defaultQuality;
              p.data.selectedCodec = result.videoQualityList[0]?.codecList[0] ?? "AVC";
              p.data.selectedAudio = result.audioQualityList[0] ?? settingsStore.settings.defaultAudioQuality;
            }
          });
        });
      });
    }
  } catch (e: any) {
    error.value = e.message || "解析失败";
  } finally {
    parsing.value = false;
  }
}

// 加入下载队列（每个选中的分 P 独立创建下载任务）
async function addToQueue() {
  if (!videoInfo.value) return;
  const downloadTasks: Array<Promise<{
    id: number;
    message: string;
}>> = [];
  sectionTrees.value.forEach((tree, sectionId) => {
    // 查找 section 名称（用于下载路径）
    const section = videoInfo.value?.ugcSeason?.sections?.find((s) => s.id === sectionId);

    tree.forEach((node) => {
      const episodeTitle = node.data.episode?.title ?? "";

      (node.children ?? []).map((p) => {
        if (p.data.type === "page" && isPageSelected(p.key) && p.data.page) {
          const pg = p.data.page;
          const vq = p.data.selectedQuality ?? settingsStore.settings.defaultQuality;
          const codec = p.data.selectedCodec || settingsStore.settings.defaultCodec || undefined;

          const bg = videoInfo.value!;

          const task = api.createDownload({
            bvid: bg.bvid,
            cid: pg.cid,
            title: episodeTitle + " - P" + pg.page + " " + pg.title,
            quality: vq,
            codec,
            outputPath: `${videoInfo.value?.ugcSeason?.title ?? ''}/${section?.title}`,
          })
          downloadTasks.push(task);
        }
      });
    });
  });
  Promise.all(downloadTasks.map(p => p.catch(err => {return {id: -1}}))).then(responses => {
    const successArr = responses.filter(r => r.id !== -1).map(r => r.id);
    queueStore.addTaskIds(successArr);
    // 还是得处理err的 TODO
  }).finally(() => {
    router.push("/downloading");
  })
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toggleExpandSection(sectionId: number) {
  expandedSections.value[sectionId] = !expandedSections.value[sectionId];
}
</script>

<template>
  <div class="space-y-6">
    <!-- Loading / Error -->
    <div v-if="loading" class="flex items-center justify-center py-20 text-zinc-500">正在加载...</div>

    <div v-else-if="error" class="rounded-lg border border-red-800 bg-red-950/50 p-6">
      <p class="text-red-400">{{ error }}</p>
      <button class="mt-3 text-sm text-zinc-400 hover:text-zinc-100" @click="router.push('/')">返回首页</button>
    </div>

    <template v-else-if="videoInfo">
      <!-- 视频信息卡片 -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5 flex gap-5">
        <div v-if="videoInfo.videoInfo.coverUrl" class="w-48 h-28 bg-zinc-800 rounded overflow-hidden shrink-0">
          <img
            :src="'/api/video/cover?url=' + encodeURIComponent(videoInfo.videoInfo.coverUrl)"
            :alt="videoInfo.title"
            class="w-full h-full object-cover"
          />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold text-zinc-100">{{ videoInfo.title }}</h2>
          <div class="flex flex-wrap gap-3 mt-2 text-sm text-zinc-400">
            <span>UP：{{ videoInfo.videoInfo.upperName }}</span>
            <span>播放：{{ videoInfo.videoInfo.playCount }}</span>
            <span v-if="videoInfo.ugcSeason" class="text-rose-400">合集：{{ videoInfo.ugcSeason.title }}</span>
          </div>
        </div>
      </div>

      <!-- 全局操作栏 -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div class="flex gap-2">
          <Button
            label="解析选中"
            severity="danger"
            size="small"
            :disabled="allSelectedCount === 0 || parsing"
            :loading="parsing"
            @click="parseSelected"
          />
          <Button
            label="加入下载队列"
            severity="success"
            size="small"
            :disabled="allSelectedCount === 0"
            @click="addToQueue"
          />
        </div>
        <span class="text-sm text-zinc-500">已选中 {{ allSelectedCount }} 个分P</span>
      </div>

      <!-- Section 块 -->
      <div v-for="[sectionId, tree] in sectionTrees" :key="sectionId" class="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
        <!-- Section 头部 -->
        <div
          class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/30"
          @click="toggleExpandSection(sectionId)"
        >
          <component :is="expandedSections[sectionId] ? ChevronDownIcon : ChevronRightIcon" class="w-4 h-4 text-zinc-500" />
          <Checkbox
            :modelValue="sectionSelectState(sectionId)"
            :binary="true"
            @update:modelValue="toggleSection(sectionId)"
          />
          <span class="text-sm font-medium text-zinc-200">
            {{ videoInfo?.ugcSeason?.sections?.find((s) => s.id === sectionId)?.title ?? '视频分P' }}
          </span>
          <span class="text-xs text-zinc-500 ml-auto">{{ tree.length }} 个视频</span>
        </div>

        <!-- Section 内容: TreeTable -->
        <div v-if="expandedSections[sectionId]">
          <TreeTable :value="tree" class="w-full text-sm" tableStyle="min-width: 100%">
            <Column header="选" class="w-12">
              <template #body="{ node }">
                <!-- Episode 级别：全选其下所有分 P -->
                <Checkbox
                  v-if="node.data.type === 'episode'"
                  :modelValue="episodeSelectState(node)"
                  :binary="true"
                  @update:modelValue="toggleEpisode(node)"
                />
                <!-- Page 级别：单个分 P 的勾选 -->
                <Checkbox
                  v-else-if="node.data.type === 'page'"
                  :modelValue="isPageSelected(node.key)"
                  :binary="true"
                  @update:modelValue="(val: boolean) => setPageSelected(node.key, val)"
                />
              </template>
            </Column>
            <Column header="名称" :expander="true">
              <template #body="{ node }">
                <span v-if="node.data.type === 'episode'" class="text-zinc-200 font-medium">
                  {{ (videoInfo?.ugcSeason?.sections?.find(s => s.id === sectionId)?.title ?? '') + (videoInfo?.ugcSeason ? ' · ' : '') }}{{ node.data.episode?.title }}
                </span>
                <span v-else class="text-zinc-400 pl-4 text-xs">
                  P{{ node.data.page?.page }} {{ node.data.page?.title }}
                </span>
              </template>
            </Column>
            <Column header="时长" class="w-20">
              <template #body="{ node }">
                <span class="text-zinc-500 text-xs">
                  {{ node.data.type === 'page' ? formatDuration(node.data.page?.duration ?? 0) : '' }}
                </span>
              </template>
            </Column>
            <Column header="画质" class="w-32">
              <template #body="{ node }">
                <template v-if="node.data.type === 'page'">
                  <Select
                    v-if="node.data.qualityList?.length"
                    v-model="node.data.selectedQuality"
                    :options="node.data.qualityList"
                    optionLabel="name"
                    optionValue="id"
                    size="small"
                    class="w-full"
                  />
                  <span v-else-if="!node.data.resolved && isPageSelected(node.key)" class="text-xs text-amber-500">待解析</span>
                  <span v-else class="text-xs text-zinc-600">-</span>
                </template>
              </template>
            </Column>
            <Column header="编码" class="w-24">
              <template #body="{ node }">
                <template v-if="node.data.type === 'page'">
                  <Select
                    v-if="node.data.qualityList?.length"
                    v-model="node.data.selectedCodec"
                    :options="node.data.qualityList?.find((q: any) => q.id === node.data.selectedQuality)?.codecList ?? []"
                    size="small"
                    class="w-full"
                  />
                  <span v-else class="text-xs text-zinc-600">-</span>
                </template>
              </template>
            </Column>
          </TreeTable>
        </div>
      </div>
    </template>
  </div>
</template>