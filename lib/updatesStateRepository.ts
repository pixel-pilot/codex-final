import type { UpdateRecord } from "./updatesRepository";
import { loadState, saveState, subscribeToState } from "./appStateRepository";

export type UpdatesFilterPayload = {
  category: UpdateRecord["category"] | "All";
  search: string;
  startDate: string | null;
  endDate: string | null;
};

export type PersistedUpdatesState = {
  entries: UpdateRecord[];
  nextCursor: string | null;
  filters: UpdatesFilterPayload;
  lastViewed: string | null;
};

const UPDATES_CACHE_KEY = "updates_cache";

export const loadUpdatesState = async (): Promise<PersistedUpdatesState | null> =>
  loadState<PersistedUpdatesState>(UPDATES_CACHE_KEY);

export const saveUpdatesState = async (
  payload: PersistedUpdatesState,
): Promise<void> => {
  await saveState(UPDATES_CACHE_KEY, payload);
};

export const subscribeToUpdatesState = (
  handler: (payload: PersistedUpdatesState | null) => void,
): (() => void) => subscribeToState(UPDATES_CACHE_KEY, handler);
