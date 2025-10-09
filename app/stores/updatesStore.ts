"use client";

import { create } from "zustand";
import {
  ListUpdatesParams,
  ListUpdatesResult,
  UpdateRecord,
  listUpdates,
} from "../../lib/updatesRepository";
import {
  loadUpdatesState,
  saveUpdatesState,
  subscribeToUpdatesState,
  type PersistedUpdatesState,
} from "../../lib/updatesStateRepository";

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
  persistedHydrated: boolean;
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

const sanitizePersistedState = (
  payload: PersistedUpdatesState | null,
): PersistedUpdatesState | null => {
  if (!payload) {
    return null;
  }

  const filters: UpdatesFilterState = {
    ...initialFilters,
    ...(payload.filters ?? initialFilters),
  };

  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    nextCursor: isValidCursor(payload.nextCursor) ? payload.nextCursor : null,
    filters,
    lastViewed: typeof payload.lastViewed === "string" ? payload.lastViewed : null,
  };
};

let lastPersistedSnapshot = "";

export const useUpdatesStore = create<UpdatesState>()((set, get) => {
  const persistState = async () => {
    if (!get().persistedHydrated) {
      return;
    }

    const payload: PersistedUpdatesState = {
      entries: get().entries,
      nextCursor: get().nextCursor,
      filters: get().filters,
      lastViewed: get().lastViewed,
    };

    const serialized = JSON.stringify(payload);
    if (serialized === lastPersistedSnapshot) {
      return;
    }

    lastPersistedSnapshot = serialized;

    try {
      await saveUpdatesState(payload);
    } catch (error) {
      console.error("Unable to persist updates cache", error);
    }
  };

  const hydrateFromPersisted = async () => {
    if (get().persistedHydrated) {
      return;
    }

    try {
      const stored = sanitizePersistedState(await loadUpdatesState());
      if (stored) {
        lastPersistedSnapshot = JSON.stringify(stored);
        set((state) => ({
          ...state,
          entries: stored.entries,
          nextCursor: stored.nextCursor,
          filters: stored.filters,
          lastViewed: stored.lastViewed,
          initialized: stored.entries.length > 0 ? true : state.initialized,
        }));
      }
    } catch (error) {
      console.error("Unable to hydrate updates cache", error);
    } finally {
      set({ persistedHydrated: true });
    }
  };

  return {
    entries: [],
    lastViewed: null,
    loading: false,
    error: null,
    nextCursor: null,
    filters: initialFilters,
    initialized: false,
    persistedHydrated: false,
    initialize: async () => {
      if (get().loading) {
        return;
      }

      await hydrateFromPersisted();

      if (get().initialized) {
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

        void persistState();
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

      await hydrateFromPersisted();

      set({ loading: true, error: null });

      try {
        const result = await listUpdates(buildListParams(get().filters));

        set({
          ...hydrateResult(result),
          loading: false,
          initialized: true,
        });

        void persistState();
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

        void persistState();
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

      void persistState();
      void get().initialize();
    },
    markAllRead: () => {
      const latest = get().entries[0]?.timestamp ?? null;
      set({ lastViewed: latest });

      void persistState();
    },
  };
});

if (typeof window !== "undefined") {
  try {
    subscribeToUpdatesState((payload) => {
      const sanitized = sanitizePersistedState(payload);
      if (!sanitized) {
        return;
      }

      const serialized = JSON.stringify(sanitized);
      if (serialized === lastPersistedSnapshot) {
        return;
      }

      lastPersistedSnapshot = serialized;

      useUpdatesStore.setState((state) => ({
        ...state,
        entries: sanitized.entries,
        nextCursor: sanitized.nextCursor,
        filters: sanitized.filters,
        lastViewed: sanitized.lastViewed,
        initialized: sanitized.entries.length > 0 ? true : state.initialized,
        persistedHydrated: true,
      }));
    });
  } catch (error) {
    console.error("Unable to subscribe to updates cache", error);
  }
}
