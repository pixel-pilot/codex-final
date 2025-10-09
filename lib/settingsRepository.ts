"use client";

import { loadState, saveState, subscribeToState } from "./appStateRepository";

export type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  pricing?: {
    prompt?: number | string | null;
    completion?: number | string | null;
  } | null;
};

export type ModelNotification = {
  id: string;
  name: string;
  timestamp: number;
};

export type PersistedSettingsState = {
  apiKey: string;
  selectedModelId: string;
  webSearchEnabled: boolean;
  maxTokens: number | "";
  temperature: number | "";
  repetitionPenalty: number | "";
  topP: number | "";
  topK: number | "";
  reasoningLevel: "off" | "standard" | "deep";
  rateLimitPerMinute: number | "";
  knownModelIds: string[];
  modelNotifications: ModelNotification[];
};

export type PersistedModelCatalog = {
  models: OpenRouterModel[];
  lastFetchedAt: number | null;
  storedAt: number;
};

const SETTINGS_STATE_KEY = "settings_preferences";
const MODEL_CATALOG_STATE_KEY = "settings_model_catalog";

export const loadSettingsState = async (): Promise<PersistedSettingsState | null> =>
  loadState<PersistedSettingsState>(SETTINGS_STATE_KEY);

export const saveSettingsState = async (
  payload: PersistedSettingsState,
): Promise<void> => {
  await saveState(SETTINGS_STATE_KEY, payload);
};

export const subscribeToSettingsState = (
  handler: (payload: PersistedSettingsState | null) => void,
): (() => void) => subscribeToState(SETTINGS_STATE_KEY, handler);

export const loadModelCatalog = async (): Promise<PersistedModelCatalog | null> =>
  loadState<PersistedModelCatalog>(MODEL_CATALOG_STATE_KEY);

export const saveModelCatalog = async (
  payload: PersistedModelCatalog,
): Promise<void> => {
  await saveState(MODEL_CATALOG_STATE_KEY, payload);
};

export const subscribeToModelCatalog = (
  handler: (payload: PersistedModelCatalog | null) => void,
): (() => void) => subscribeToState(MODEL_CATALOG_STATE_KEY, handler);
