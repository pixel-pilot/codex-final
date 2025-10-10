"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient";

const TABLE_NAME = "app_state";
const LOCAL_STORAGE_NAMESPACE = TABLE_NAME;
const LOCAL_STORAGE_CHANNEL_NAMESPACE = `${TABLE_NAME}_broadcast`;

type AppStateRow<T> = {
  key: string;
  payload: T;
  updated_at?: string;
};

const buildChannelName = (key: string) => `${TABLE_NAME}:${key}`;
const buildStorageKey = (key: string) => `${LOCAL_STORAGE_NAMESPACE}:${key}`;
const buildLocalChannelName = (key: string) =>
  `${LOCAL_STORAGE_CHANNEL_NAMESPACE}:${key}`;

const isBrowserEnvironment = () => typeof window !== "undefined";

type LocalBroadcastMessage<T> = {
  key: string;
  payload: T | null;
};

let cachedSupabaseClient: SupabaseClient | null | undefined;

const clearCachedSupabaseClient = () => {
  cachedSupabaseClient = undefined;
};

const getSupabaseClientOrNull = (): SupabaseClient | null => {
  if (cachedSupabaseClient !== undefined) {
    return cachedSupabaseClient;
  }

  try {
    if (typeof getSupabaseClient !== "function") {
      clearCachedSupabaseClient();
      return null;
    }

    const client = getSupabaseClient();
    cachedSupabaseClient = client ?? null;
    return cachedSupabaseClient;
  } catch (error) {
    console.warn("Falling back to local persistence: Supabase client unavailable.", error);
    clearCachedSupabaseClient();
    return null;
  }
};

const getLocalStorage = (): Storage | null => {
  if (!isBrowserEnvironment()) {
    return null;
  }

  try {
    return window.localStorage ?? null;
  } catch (error) {
    console.warn("Access to localStorage failed; settings persistence disabled.", error);
    return null;
  }
};

const parseStoredValue = <T>(key: string, rawValue: string | null): T | null => {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn(`Unable to parse stored state for key "${key}".`, error);
    const storage = getLocalStorage();
    try {
      storage?.removeItem(buildStorageKey(key));
    } catch (removeError) {
      console.warn(`Failed to remove corrupt state for key "${key}".`, removeError);
    }
    return null;
  }
};

const readFromLocalStorage = <T>(key: string): T | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  const rawValue = storage.getItem(buildStorageKey(key));
  return parseStoredValue<T>(key, rawValue);
};

const notifyLocalSubscribers = <T>(key: string, payload: T | null) => {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(buildLocalChannelName(key));
    const message: LocalBroadcastMessage<T> = { key, payload };
    channel.postMessage(message);
    channel.close();
  } catch (error) {
    console.warn(`BroadcastChannel unavailable for key "${key}".`, error);
  }
};

const writeToLocalStorage = <T>(key: string, payload: T) => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(buildStorageKey(key), JSON.stringify(payload));
    notifyLocalSubscribers(key, payload);
  } catch (error) {
    console.error(`Failed to persist state for key "${key}" to localStorage.`, error);
  }
};

const subscribeToLocalState = <T>(
  key: string,
  handler: (payload: T | null) => void,
): (() => void) => {
  if (!isBrowserEnvironment()) {
    return () => {};
  }

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== buildStorageKey(key)) {
      return;
    }

    handler(parseStoredValue<T>(key, event.newValue));
  };

  window.addEventListener("storage", storageHandler);

  let channel: BroadcastChannel | null = null;
  const channelHandler = (event: MessageEvent<LocalBroadcastMessage<T>>) => {
    const message = event?.data;
    if (!message || message.key !== key) {
      return;
    }

    handler(message.payload ?? null);
  };

  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(buildLocalChannelName(key));
      channel.addEventListener("message", channelHandler as EventListener);
    }
  } catch (error) {
    console.warn(`Unable to subscribe via BroadcastChannel for key "${key}".`, error);
  }

  return () => {
    window.removeEventListener("storage", storageHandler);
    if (channel) {
      channel.removeEventListener("message", channelHandler as EventListener);
      channel.close();
    }
  };
};

export const loadState = async <T>(key: string): Promise<T | null> => {
  const client = getSupabaseClientOrNull();

  if (!client) {
    return readFromLocalStorage<T>(key);
  }

  try {
    const { data, error } = await client
      .from(TABLE_NAME)
      .select("payload")
      .eq("key", key)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const record = data as AppStateRow<T> | null;

    return record?.payload ?? null;
  } catch (error) {
    console.warn(
      `Supabase read for key "${key}" failed; falling back to local storage.`,
      error,
    );
    clearCachedSupabaseClient();
    return readFromLocalStorage<T>(key);
  }
};

export const saveState = async <T>(key: string, payload: T): Promise<void> => {
  const client = getSupabaseClientOrNull();

  if (!client) {
    writeToLocalStorage(key, payload);
    return;
  }

  try {
    const { error } = await client.from(TABLE_NAME).upsert(
      { key, payload } satisfies AppStateRow<T>,
      {
        onConflict: "key",
      },
    );

    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn(
      `Supabase write for key "${key}" failed; using local storage instead.`,
      error,
    );
    clearCachedSupabaseClient();
    writeToLocalStorage(key, payload);
  }
};

export const subscribeToState = <T>(
  key: string,
  handler: (payload: T | null) => void,
): (() => void) => {
  const fallbackSubscribe = () => subscribeToLocalState(key, handler);
  const client = getSupabaseClientOrNull();

  if (!client) {
    return fallbackSubscribe();
  }

  let channel: RealtimeChannel | null = null;
  let fallbackCleanup: (() => void) | null = null;

  try {
    channel = client
      .channel(buildChannelName(key))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: TABLE_NAME,
          filter: `key=eq.${key}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            handler(null);
            return;
          }

          const record = payload.new as AppStateRow<T> | null;
          handler(record?.payload ?? null);
        },
      );

    const subscribeResult = channel.subscribe();

    if (subscribeResult instanceof Promise) {
      subscribeResult.catch((error) => {
        console.warn(
          `Supabase subscription for key "${key}" failed; reverting to local subscriptions.`,
          error,
        );
        clearCachedSupabaseClient();
        void client.removeChannel(channel as RealtimeChannel);
        if (!fallbackCleanup) {
          fallbackCleanup = fallbackSubscribe();
        }
      });
    }
  } catch (error) {
    console.warn(
      `Supabase subscription for key "${key}" failed; reverting to local subscriptions.`,
      error,
    );
    clearCachedSupabaseClient();
    return fallbackSubscribe();
  }

  return () => {
    fallbackCleanup?.();
    fallbackCleanup = null;
    if (channel) {
      void client.removeChannel(channel);
    }
  };
};
