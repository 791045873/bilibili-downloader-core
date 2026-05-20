import { defineStore } from "pinia";
import { ref, computed } from "vue";

const STORAGE_KEY = "bilibili-downloader-task-ids";

export const useDownloadQueueStore = defineStore("downloadQueue", () => {
  /** 所有已创建的下载任务 ID */
  const taskIds = ref<number[]>([]);

  const hasTasks = computed(() => taskIds.value.length > 0);

  // ==================== 持久化 ====================

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        taskIds.value = JSON.parse(stored);
        console.log('load Storage', taskIds.value);
      }
    } catch {
      // ignore
    }
  }

  function saveToStorage() {
    console.log('saveToStorage', taskIds.value)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(taskIds.value));
  }

  // ==================== 操作 ====================

  function addTaskId(id: number) {
    if (!taskIds.value.includes(id)) {
      taskIds.value.push(id);
      saveToStorage();
    }
  }
  
  function addTaskIds(ids: number[]) {
    ids.forEach(id => {
      if (!taskIds.value.includes(id)) {
        taskIds.value.push(id);
      }
    })
    saveToStorage();
  }

  function removeTaskId(id: number) {
    taskIds.value = taskIds.value.filter((tid) => tid !== id);
    saveToStorage();
  }

  function clearFinished(finishedIds: number[]) {
    taskIds.value = taskIds.value.filter((tid) => !finishedIds.includes(tid));
    saveToStorage();
  }

  function init() {
    loadFromStorage();
  }

  return {
    taskIds,
    hasTasks,
    addTaskId,
    addTaskIds,
    removeTaskId,
    clearFinished,
    init,
  };
});