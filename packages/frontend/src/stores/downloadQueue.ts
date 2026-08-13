import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "bilibili-downloader-task-ids";

interface DownloadQueueState {
  taskIds: number[];
  addTaskId: (id: number) => void;
  addTaskIds: (ids: number[]) => void;
  removeTaskId: (id: number) => void;
  clearFinished: (finishedIds: number[]) => void;
}

// 旧版（Pinia）直接存储裸数字数组；zustand persist 存储 {state, version} 信封。
// 模块加载时把旧格式一次性转写为信封，避免既有队列 ID 被静默重置。
function migrateLegacyStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { taskIds: parsed }, version: 0 }),
      );
    }
  } catch {
    // ignore
  }
}

migrateLegacyStorage();

export const useDownloadQueueStore = create<DownloadQueueState>()(
  persist(
    (set) => ({
      taskIds: [],
      addTaskId: (id) =>
        set((state) =>
          state.taskIds.includes(id)
            ? state
            : { taskIds: [...state.taskIds, id] },
        ),
      addTaskIds: (ids) =>
        set((state) => {
          const merged = [...state.taskIds];
          let changed = false;
          for (const id of ids) {
            if (!merged.includes(id)) {
              merged.push(id);
              changed = true;
            }
          }
          return changed ? { taskIds: merged } : state;
        }),
      removeTaskId: (id) =>
        set((state) => ({
          taskIds: state.taskIds.filter((tid) => tid !== id),
        })),
      clearFinished: (finishedIds) =>
        set((state) => ({
          taskIds: state.taskIds.filter((tid) => !finishedIds.includes(tid)),
        })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ taskIds: state.taskIds }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<DownloadQueueState> | null;
        return {
          ...currentState,
          ...persisted,
          taskIds: Array.isArray(persisted?.taskIds) ? persisted.taskIds : [],
        };
      },
    },
  ),
);
