"use client";

import { loadState, saveState, subscribeToState } from "./appStateRepository";

export type PersistedSystemState = {
  active: boolean;
  updatedAt: string;
};

const SYSTEM_STATE_KEY = "system_status";

const sanitizeSystemState = (payload: unknown): PersistedSystemState | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Partial<PersistedSystemState>;

  if (typeof candidate.active !== "boolean") {
    return null;
  }

  if (typeof candidate.updatedAt !== "string") {
    return {
      active: candidate.active,
      updatedAt: new Date().toISOString(),
    } satisfies PersistedSystemState;
  }

  return {
    active: candidate.active,
    updatedAt: candidate.updatedAt,
  } satisfies PersistedSystemState;
};

export const loadSystemState = async (): Promise<PersistedSystemState | null> => {
  const stored = await loadState<unknown>(SYSTEM_STATE_KEY);
  return sanitizeSystemState(stored);
};

export const saveSystemState = async (
  payload: PersistedSystemState,
): Promise<void> => {
  await saveState(SYSTEM_STATE_KEY, payload);
};

export const subscribeToSystemState = (
  handler: (payload: PersistedSystemState | null) => void,
): (() => void) =>
  subscribeToState<unknown>(SYSTEM_STATE_KEY, (payload) => {
    handler(sanitizeSystemState(payload));
  });
