<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import TreeTable from "primevue/treetable";
import Column from "primevue/column";
import Checkbox from "primevue/checkbox";
import Button from "primevue/button";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { useSettingsStore } from "../stores/settings";
import { useDownloadQueueStore } from "../stores/useDownloadQueueStore";
import * as api from "../api";
import type { VideoInfo, VideoPage, UgcSection, UgcEpisode, SubtitleLang } from "../types";

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const queueStore = useDownloadQueueStore();

const loading = ref(true);
const error = ref("");
const videoInfo = ref<VideoInfo | null>(null);

// 当前选中的 section id
const selectedSectionId = ref<number>(0);

interface TreeNode {
  key: string;
  data: {
    type: "episode" | "page";
    episode?: UgcEpisode;
    page?: VideoPage;
    resolved: boolean;
    downloaded: boolean;
    qualityList?: { id: number; name: string; codecList: string[] }[];
    audioQualityList?: string[];
    selectedQuality?: number;
    selectedCodec?: string;
    selectedAudio?: string;
    selectedSubtitleLang: SubtitleLang;
  };
  children?: TreeNode[];
}

const sectionTrees = ref<Map<number, TreeNode[]>>(new Map());
const selectedKeys = ref<Set<string>>(new Set());

function isPageSelected(nodeKey: string): boolean {
  return selectedKeys.value.has(nodeKey);
}

function setPageSelected(nodeKey: string, val: boolean) {
  if (val) selectedKeys.value.add(nodeKey);
  else selectedKeys.value.delete(nodeKey);
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
      for (const sec of info.ugcSeason.sections) {
        sectionTrees.value.set(sec.id, buildEpisodeTree(sec));
      }
      selectedSectionId.value = info.ugcSeason.sections[0]?.id ?? 0;
    } else {
      const flatSectionId = -1;
      sectionTrees.value.set(flatSectionId, [buildMockVideoNode(info)]);
      selectedSectionId.value = flatSectionId;
    }

    const allBvidCids = collectBvidCids();
    if (allBvidCids.length > 0) {
      const existing = await api.checkTasks(allBvidCids);
      markDownloaded(existing);
    }
  } catch (e: any) {
    error.value = e.message || "获取视频信息失败";
  } finally {
    loading.value = false;
  }
});

function collectBvidCids(): { bvid: string; cid: number }[] {
  const pairs: { bvid: string; cid: number }[] = [];
  sectionTrees.value.forEach((tree) => {
    tree.forEach((node) => {
      (node.children ?? []).forEach((p) => {
        if (p.data.type === "page" && p.data.page) {
          pairs.push({ bvid: videoInfo.value!.bvid, cid: p.data.page.cid });
        }
      });
    });
  });
  return pairs;
}

function markDownloaded(records: { bvid: string; cid: number }[]) {
  sectionTrees.value.forEach((tree) => {
    tree.forEach((node) => {
      (node.children ?? []).forEach((p) => {
        if (p.data.type !== "page" || !p.data.page) return;
        const rec = records.find(
          (r) => r.bvid === videoInfo.value!.bvid && r.cid === p.data.page!.cid,
        );
        if (!rec) return;
        p.data.downloaded = true;
      });
    });
  });
}

function buildEpisodeTree(section: UgcSection): TreeNode[] {
  return section.episodes.map((ep) => ({
    key: `${section.id}-${ep.cid}`,
    data: { type: "episode" as const, episode: ep, resolved: false, downloaded: false, selectedSubtitleLang: "none" as const },
    children: ep.pages.map((p) => ({
      key: `${section.id}-${ep.cid}-${p.cid}`,
      data: { type: "page" as const, page: p, resolved: false, downloaded: false, selectedSubtitleLang: "none" as const },
    })),
  }));
}

function buildMockVideoNode(info: VideoInfo): TreeNode {
  return {
    key: `video-${info.bvid}`,
    data: {
      type: "episode" as const,
      episode: { aid: info.videoInfo.avid, bvid: info.bvid, cid: info.pages[0]?.cid ?? 0, title: info.title, pages: info.pages },
      resolved: false,
      downloaded: false,
      selectedSubtitleLang: "none",
    },
    children: info.pages.map((p) => ({
      key: `video-${info.bvid}-${p.cid}`,
      data: { type: "page" as const, page: p, resolved: false, downloaded: false, selectedSubtitleLang: "none" as const },
    })),
  };
}

const currentTree = computed(() => sectionTrees.value.get(selectedSectionId.value) ?? []);

const currentSectionTitle = computed(() => {
  if (!videoInfo.value?.ugcSeason?.sections) return "";
  return videoInfo.value.ugcSeason.sections.find((s) => s.id === selectedSectionId.value)?.title ?? "";
});

const currentSectionDefaultPath = computed(() => {
  if (!videoInfo.value) return "";
  return videoInfo.value.ugcSeason?.title
    ? `${videoInfo.value.ugcSeason.title}/${currentSectionTitle.value}`
    : videoInfo.value.title;
});

const allSelectedCount = computed(() => selectedKeys.value.size);

function toggleSection() {
  const tree = currentTree.value;
  if (!tree) return;
  const allSel = tree.every((ep) => (ep.children ?? []).every((p) => isPageSelected(p.key)));
  tree.forEach((ep) => {
    (ep.children ?? []).forEach((p) => {
      setPageSelected(p.key, !allSel);
    });
  });
}

function sectionSelectState(): boolean | null {
  const tree = currentTree.value;
  if (!tree || tree.length === 0) return false;
  let allPages = 0, selPages = 0;
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

function toggleEpisode(node: TreeNode) {
  const pages = node.children ?? [];
  if (pages.length === 0) return;
  const allSel = pages.every((p) => isPageSelected(p.key));
  pages.forEach((p) => {
    setPageSelected(p.key, !allSel);
  });
}

function episodeSelectState(node: TreeNode): boolean | null {
  const pages = node.children ?? [];
  if (pages.length === 0) return false;
  const allSel = pages.every((p) => isPageSelected(p.key));
  const noneSel = pages.every((p) => !isPageSelected(p.key));
  return allSel ? true : noneSel ? false : null;
}

const parsing = ref(false);

async function parseAllInSection() {
  if (!videoInfo.value) return;
  parsing.value = true;
  try {
    const unresolvedPages: { bvid: string; cid: number }[] = [];
    const tree = currentTree.value;
    tree.forEach((node) => {
      (node.children ?? []).forEach((p) => {
        if (p.data.type === "page" && !p.data.resolved && p.data.page) {
          unresolvedPages.push({ bvid: videoInfo.value!.bvid, cid: p.data.page.cid });
        }
      });
    });
    if (unresolvedPages.length === 0) return;

    const cids = unresolvedPages.map((e) => e.cid);
    const results = await api.parseAllVideos(videoInfo.value.bvid, cids);
    for (const result of results) {
      tree.forEach((node) => {
        (node.children ?? []).forEach((p) => {
          if (p.data.type === "page" && p.data.page?.cid === result.cid) {
            p.data.resolved = true;
            p.data.qualityList = result.videoQualityList;
            p.data.audioQualityList = result.audioQualityList;
            p.data.selectedQuality = result.videoQualityList[0]?.id ?? settingsStore.settings.defaultQuality;
            p.data.selectedCodec = result.videoQualityList[0]?.codecList[0] ?? "AVC";
            p.data.selectedAudio = result.audioQualityList[0] ?? settingsStore.settings.defaultAudioQuality;
            p.data.selectedSubtitleLang = "none";
          }
        });
      });
    }
  } catch (e: any) {
    error.value = e.message || "解析失败";
  } finally {
    parsing.value = false;
  }
}

const showDirDialog = ref(false);
const dirDialogValue = ref("");

function openDirDialog() {
  dirDialogValue.value = currentSectionDefaultPath.value;
  showDirDialog.value = true;
}

function confirmDirDialog() {
  if (!dirDialogValue.value.trim()) return;
  showDirDialog.value = false;
  doAddToQueue(dirDialogValue.value);
}

async function addToQueue() {
  openDirDialog();
}

async function doAddToQueue(outputPath: string) {
  if (!videoInfo.value) return;
  const downloadTasks: Array<Promise<{ id: number; message: string }>> = [];
  const tree = currentTree.value;

  tree.forEach((node) => {
    const episodeTitle = node.data.episode?.title ?? "";
    (node.children ?? []).forEach((p) => {
      if (p.data.type === "page" && isPageSelected(p.key) && p.data.page) {
        const pg = p.data.page;
        const vq = p.data.selectedQuality ?? settingsStore.settings.defaultQuality;
        const codec = p.data.selectedCodec || settingsStore.settings.defaultCodec || undefined;
        const subtitleLang = p.data.selectedSubtitleLang || "none";
        const task = api.createDownload({
          bvid: videoInfo.value!.bvid,
          cid: pg.cid,
          title: episodeTitle + " - P" + pg.page + " " + pg.title,
          quality: vq,
          codec,
          outputPath,
          fileNameTemplate: settingsStore.settings.defaultFileNameTemplate,
          subtitleLang,
        });
        downloadTasks.push(task);
      }
    });
  });

  try {
    const responses = await Promise.all(
      downloadTasks.map((p) => p.catch(() => ({ id: -1, message: "" }))),
    );
    const successArr = responses.filter((r) => r.id !== -1).map((r) => r.id);
    queueStore.addTaskIds(successArr);

    tree.forEach((node) => {
      (node.children ?? []).forEach((p) => {
        if (p.data.type === "page" && isPageSelected(p.key) && p.data.page) {
          p.data.downloaded = true;
          setPageSelected(p.key, false);
        }
      });
    });
  } catch (e: any) {
    error.value = e.message || "加入队列失败";
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const subtitleOptions = [
  { label: "不下载", value: "none" },
  { label: "中文", value: "zh" },
  { label: "英文", value: "en" },
  { label: "全部字幕", value: "all" },
];
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="flex items-center justify-center py-20 text-zinc-500">正在加载...</div>

    <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 p-6">
      <p class="text-red-600">{{ error }}</p>
      <button class="mt-3 text-sm text-zinc-600 hover:text-zinc-900" @click="router.push('/')">返回首页</button>
    </div>

    <template v-else-if="videoInfo">
      <div class="rounded-lg border border-zinc-200 bg-white p-5 flex gap-5">
        <div v-if="videoInfo.videoInfo.coverUrl" class="w-48 h-28 bg-zinc-100 rounded overflow-hidden shrink-0">
          <img :src="'/api/video/cover?url=' + encodeURIComponent(videoInfo.videoInfo.coverUrl)" :alt="videoInfo.title" class="w-full h-full object-cover" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold text-zinc-900">{{ videoInfo.title }}</h2>
          <div class="flex flex-wrap gap-3 mt-2 text-sm text-zinc-600">
            <span>UP：{{ videoInfo.videoInfo.upperName }}</span>
            <span>播放：{{ videoInfo.videoInfo.playCount }}</span>
            <span v-if="videoInfo.ugcSeason" class="text-rose-600">合集：{{ videoInfo.ugcSeason.title }}</span>
          </div>
        </div>
      </div>

      <div v-if="videoInfo.ugcSeason?.sections" class="flex flex-wrap gap-2">
        <button
          v-for="sec in videoInfo.ugcSeason.sections"
          :key="sec.id"
          class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          :class="selectedSectionId === sec.id ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'"
          @click="selectedSectionId = sec.id"
        >
          {{ sec.title }}
        </button>
      </div>

      <div class="rounded-lg border border-zinc-200 bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
        <div class="flex gap-2">
          <Button label="解析当前页所有视频" severity="danger" size="small" :disabled="parsing" :loading="parsing" @click="parseAllInSection" />
          <Button label="加入下载队列" severity="success" size="small" :disabled="allSelectedCount === 0" @click="addToQueue" />
        </div>
        <span class="text-sm text-zinc-500">已选中 {{ allSelectedCount }} 个分P</span>
      </div>

      <div class="rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
          <Checkbox :modelValue="sectionSelectState()" :binary="true" @update:modelValue="toggleSection()" />
          <span class="text-sm font-medium text-zinc-800">{{ currentSectionTitle || '视频分P' }}</span>
          <span class="text-xs text-zinc-500 ml-auto">{{ currentTree.length }} 个视频</span>
        </div>

        <TreeTable :value="currentTree" class="w-full text-sm" tableStyle="min-width: 100%">
          <Column header="选择" class="w-14">
            <template #body="{ node }">
              <Checkbox v-if="node.data.type === 'episode'" :modelValue="episodeSelectState(node)" :binary="true" @update:modelValue="toggleEpisode(node)" />
              <Checkbox v-else-if="node.data.type === 'page'" :modelValue="isPageSelected(node.key)" :binary="true" @update:modelValue="(val: boolean) => setPageSelected(node.key, val)" />
            </template>
          </Column>
          <Column header="名称" :expander="true">
            <template #body="{ node }">
              <span v-if="node.data.type === 'episode'" class="text-zinc-800 font-medium">{{ node.data.episode?.title }}</span>
              <span v-else class="text-zinc-600 pl-4 text-xs">
                P{{ node.data.page?.page }} {{ node.data.page?.title }}
                <span v-if="node.data.downloaded" class="ml-2 text-emerald-600">已下载</span>
              </span>
            </template>
          </Column>
          <Column header="时长" class="w-20">
            <template #body="{ node }">
              <span class="text-zinc-500 text-xs">{{ node.data.type === 'page' ? formatDuration(node.data.page?.duration ?? 0) : '' }}</span>
            </template>
          </Column>
          <Column header="画质" class="w-32">
            <template #body="{ node }">
              <template v-if="node.data.type === 'page'">
                <Select v-if="node.data.qualityList?.length" v-model="node.data.selectedQuality" :options="node.data.qualityList" optionLabel="name" optionValue="id" size="small" class="w-full" />
                <span v-else-if="!node.data.resolved" class="text-xs text-amber-500">待解析</span>
                <span v-else class="text-xs text-zinc-400">-</span>
              </template>
            </template>
          </Column>
          <Column header="编码" class="w-24">
            <template #body="{ node }">
              <template v-if="node.data.type === 'page'">
                <Select v-if="node.data.qualityList?.length" v-model="node.data.selectedCodec" :options="node.data.qualityList?.find((q: any) => q.id === node.data.selectedQuality)?.codecList ?? []" size="small" class="w-full" />
                <span v-else class="text-xs text-zinc-400">-</span>
              </template>
            </template>
          </Column>
          <Column header="字幕" class="w-28">
            <template #body="{ node }">
              <template v-if="node.data.type === 'page'">
                <Select v-if="node.data.resolved" v-model="node.data.selectedSubtitleLang" :options="subtitleOptions" size="small" class="w-full" />
                <span v-else class="text-xs text-amber-500">待解析</span>
              </template>
            </template>
          </Column>
        </TreeTable>
      </div>
    </template>

    <Dialog v-model:visible="showDirDialog" header="确认下载子目录" :modal="true" :closable="true" :style="{ width: '450px' }">
      <div class="flex flex-col gap-3">
        <label class="text-sm text-zinc-600">请确认或修改下载根目录下的相对子目录：</label>
        <InputText v-model="dirDialogValue" class="w-full" placeholder="例如：合集标题/分区标题" />
        <p class="text-xs text-zinc-500">最终文件会保存到服务端下载根目录下的该子目录中。</p>
        <p v-if="!dirDialogValue.trim()" class="text-xs text-red-600">目录不能为空</p>
      </div>
      <template #footer>
        <Button label="取消" severity="secondary" size="small" @click="showDirDialog = false" />
        <Button label="确认" severity="success" size="small" :disabled="!dirDialogValue.trim()" @click="confirmDirDialog" />
      </template>
    </Dialog>
  </div>
</template>