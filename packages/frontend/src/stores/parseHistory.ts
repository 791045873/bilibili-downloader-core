import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "bilibili-downloader-parse-history";
const MAX_ENTRIES = 12;

export type ParseHistoryType = "video" | "ugc-season" | "favorites" | "user-videos";

export interface ParseHistoryEntry {
  key: string;
  type: ParseHistoryType;
  title: string;
  coverUrl?: string;
  params: Record<string, string>;
  parsedAt: number;
}

interface ParseHistoryState {
  entries: ParseHistoryEntry[];
  record: (entry: ParseHistoryEntry) => void;
  remove: (key: string) => void;
}

function isValidEntry(value: unknown): value is ParseHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<ParseHistoryEntry>;
  return (
    typeof entry.key === "string" &&
    entry.key.length > 0 &&
    typeof entry.title === "string" &&
    typeof entry.params === "object" &&
    entry.params !== null &&
    typeof entry.parsedAt === "number"
  );
}

export const useParseHistoryStore = create<ParseHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      record: (entry) =>
        set((state) => {
          const rest = state.entries.filter((e) => e.key !== entry.key);
          return { entries: [entry, ...rest].slice(0, MAX_ENTRIES) };
        }),
      remove: (key) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.key !== key),
        })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ entries: state.entries }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ParseHistoryState> | null;
        const entries = Array.isArray(persisted?.entries)
          ? persisted.entries.filter(isValidEntry)
          : [];
        return { ...currentState, entries };
      },
    },
  ),
);
