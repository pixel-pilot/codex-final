"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ListUpdatesParams,
  ListUpdatesResult,
  UpdateRecord,
  listUpdates,
} from "../../lib/updatesRepository";

const LOCAL_STORAGE_KEY = "reactive-ai-updates-cache-v1";

export type UpdatesFilterState = {
  category: UpdateRecord["category"] | "All";
  search: string;
  startDate: string | null;
  endDate: string | null;
};

export type UpdatesState = {
  entries: UpdateRecord[];
  lastViewed: string | null;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  filters: UpdatesFilterState;
  initialized: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (filters: Partial<UpdatesFilterState>) => void;
  markAllRead: () => void;
};

const initialFilters: UpdatesFilterState = {
  category: "All",
  search: "",
  startDate: null,
  endDate: null,
};

type PersistedState = Pick<
  UpdatesState,
  "entries" | "nextCursor" | "filters" | "lastViewed"
>;

const hydrateResult = ({ entries, nextCursor }: ListUpdatesResult) => ({
  entries,
  nextCursor,
});

const buildListParams = (
  filters: UpdatesFilterState,
  extras: Partial<ListUpdatesParams> = {}
): ListUpdatesParams => ({
  limit: 20,
  category: filters.category,
  search: filters.search,
  startDate: filters.startDate ?? undefined,
  endDate: filters.endDate ?? undefined,
  ...extras,
});

const noopStorage: Storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const isValidCursor = (value: string | null): boolean => {
  if (!value) {
    return true;
  }

  try {
    const parsed = JSON.parse(value) as { timestamp?: unknown; id?: unknown };

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.timestamp === "string" &&
      typeof parsed.id === "string"
    );
  } catch (error) {
    return false;
  }
};

export const useUpdatesStore = create<UpdatesState>()(
  persist(
    (set, get) => ({
      entries: [],
      lastViewed: null,
      loading: false,
      error: null,
      nextCursor: null,
      filters: initialFilters,
      initialized: false,
      initialize: async () => {
        if (get().initialized || get().loading) {
          return;
        }

        set({ loading: true, error: null });

        try {
          const result = await listUpdates(buildListParams(get().filters));

          set({
            ...hydrateResult(result),
            loading: false,
            initialized: true,
          });
        } catch (error) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      refresh: async () => {
        if (get().loading) {
          return;
        }

        set({ loading: true, error: null });

        try {
          const result = await listUpdates(buildListParams(get().filters));

          set({
            ...hydrateResult(result),
            loading: false,
            initialized: true,
          });
        } catch (error) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      loadMore: async () => {
        const { nextCursor, loading } = get();
        if (!nextCursor || loading) {
          return;
        }

        set({ loading: true, error: null });

        try {
          const result = await listUpdates(
            buildListParams(get().filters, { cursor: nextCursor })
          );

          set({
            entries: [...get().entries, ...result.entries],
            nextCursor: result.nextCursor,
            loading: false,
          });
        } catch (error) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      setFilters: (filters) => {
        const nextFilters = { ...get().filters, ...filters };

        set({
          filters: nextFilters,
          initialized: false,
          entries: [],
          nextCursor: null,
        });

        void get().initialize();
      },
      markAllRead: () => {
        const latest = get().entries[0]?.timestamp ?? null;
        set({ lastViewed: latest });
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.localStorage
      ),
      partialize: (state): PersistedState => ({
        entries: state.entries,
        nextCursor: state.nextCursor,
        filters: state.filters,
        lastViewed: state.lastViewed,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        state.initialized = state.entries.length > 0;

        if (!isValidCursor(state.nextCursor)) {
          state.nextCursor = null;
        }
      },
    }
  )
);
