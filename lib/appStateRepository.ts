import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient";

const TABLE_NAME = "app_state";

type AppStateRow<T> = {
  key: string;
  payload: T;
  updated_at?: string;
};

const buildChannelName = (key: string) => `${TABLE_NAME}:${key}`;

export const loadState = async <T>(key: string): Promise<T | null> => {
  const client = getSupabaseClient();

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
};

export const saveState = async <T>(key: string, payload: T): Promise<void> => {
  const client = getSupabaseClient();

  const { error } = await client.from(TABLE_NAME).upsert(
    { key, payload } satisfies AppStateRow<T>,
    {
      onConflict: "key",
    },
  );

  if (error) {
    throw error;
  }
};

export const subscribeToState = <T>(
  key: string,
  handler: (payload: T | null) => void,
): (() => void) => {
  const client = getSupabaseClient();

  let channel: RealtimeChannel | null = null;

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
      )
      .subscribe();
  } catch (error) {
    console.error(`Unable to subscribe to state key "${key}"`, error);
  }

  return () => {
    if (channel) {
      void client.removeChannel(channel);
    }
  };
};
