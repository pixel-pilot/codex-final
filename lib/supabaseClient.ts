"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

type SupabaseClientCache = {
  browserSupabaseClient?: SupabaseClient;
};

const globalCache = globalThis as typeof globalThis & SupabaseClientCache;

const getCachedClient = (): SupabaseClient | null => {
  if (globalCache.browserSupabaseClient) {
    return globalCache.browserSupabaseClient;
  }

  return null;
};

const cacheClient = (client: SupabaseClient): void => {
  globalCache.browserSupabaseClient = client;
};

export const getSupabaseClient = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Define it in your environment to enable changelog retrieval."
    );
  }

  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Define it in your environment to enable changelog retrieval."
    );
  }

  const existing = getCachedClient();

  if (existing) {
    return existing;
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  cacheClient(client);

  return client;
};

export type { SupabaseClient };
