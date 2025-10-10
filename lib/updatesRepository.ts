"use client";

import { getSupabaseClient } from "./supabaseClient";
import { bundledUpdates } from "./staticUpdates";

export type UpdateRecord = {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  category: "Feature" | "Fix" | "Improvement" | "UI" | "System" | "Note";
  version: string | null;
  author: string | null;
};

export type ListUpdatesParams = {
  limit?: number;
  cursor?: string | null;
  category?: UpdateRecord["category"] | "All";
  search?: string;
  startDate?: string;
  endDate?: string;
};

export type ListUpdatesResult = {
  entries: UpdateRecord[];
  nextCursor: string | null;
};

const TABLE_NAME = "app_updates";
const SELECT_FIELDS =
  "id, timestamp, title, description, category, version, author";

type UpdateRow = {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  category: UpdateRecord["category"];
  version: string | null;
  author: string | null;
};

type CursorPayload = {
  timestamp: string;
  id: string;
};

const serializeCursor = (entry: UpdateRecord | undefined): string | null => {
  if (!entry) {
    return null;
  }

  return JSON.stringify({ timestamp: entry.timestamp, id: entry.id });
};

const parseCursor = (cursor: string | null | undefined): CursorPayload | null => {
  if (!cursor) {
    return null;
  }

  try {
    const payload = JSON.parse(cursor) as CursorPayload;

    if (payload.timestamp && payload.id) {
      return payload;
    }

    return null;
  } catch (error) {
    return null;
  }
};

const applyFilters = (query: any, params: ListUpdatesParams) => {
  const next = query
    .order("timestamp", { ascending: false })
    .order("id", { ascending: false });

  if (params.category && params.category !== "All") {
    next.eq("category", params.category);
  }

  if (params.startDate) {
    next.gte("timestamp", params.startDate);
  }

  if (params.endDate) {
    next.lte("timestamp", params.endDate);
  }

  if (params.search) {
    next.textSearch("fts", params.search, {
      type: "plain",
    });
  }

  if (params.limit) {
    next.limit(params.limit);
  }

  const cursor = parseCursor(params.cursor);

  if (cursor) {
    next.or(
      `timestamp.lt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.lt.${cursor.id})`
    );
  }

  return next;
};

const normalizeRows = (rows: UpdateRow[] | null | undefined): UpdateRecord[] =>
  (rows ?? []).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    title: row.title,
    description: row.description,
    category: row.category,
    version: row.version,
    author: row.author,
  }));

const requireSupabaseClient = () => {
  if (typeof getSupabaseClient !== "function") {
    throw new Error("Supabase client helper is unavailable in the browser bundle.");
  }

  return getSupabaseClient();
};

const isEntryAfterCursor = (entry: UpdateRecord, cursor: CursorPayload) =>
  entry.timestamp < cursor.timestamp ||
  (entry.timestamp === cursor.timestamp && entry.id < cursor.id);

const compareEntriesDesc = (left: UpdateRecord, right: UpdateRecord) => {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp > right.timestamp ? -1 : 1;
  }

  if (left.id === right.id) {
    return 0;
  }

  return left.id > right.id ? -1 : 1;
};

const matchesCategory = (
  entry: UpdateRecord,
  category: ListUpdatesParams["category"],
) => !category || category === "All" || entry.category === category;

const matchesDateRange = (
  entry: UpdateRecord,
  startDate?: string,
  endDate?: string,
) => {
  const timestamp = entry.timestamp;

  if (startDate && timestamp < startDate) {
    return false;
  }

  if (endDate && timestamp > endDate) {
    return false;
  }

  return true;
};

const matchesSearch = (entry: UpdateRecord, search?: string) => {
  if (!search) {
    return true;
  }

  const term = search.trim().toLowerCase();

  if (!term) {
    return true;
  }

  return (
    entry.title.toLowerCase().includes(term) ||
    entry.description.toLowerCase().includes(term)
  );
};

const listUpdatesFromStatic = (params: ListUpdatesParams): ListUpdatesResult => {
  const filtered = bundledUpdates
    .filter((entry) =>
      matchesCategory(entry, params.category) &&
      matchesDateRange(entry, params.startDate, params.endDate) &&
      matchesSearch(entry, params.search),
    )
    .sort(compareEntriesDesc);

  const cursor = parseCursor(params.cursor);

  const afterCursor = cursor
    ? filtered.filter((entry) => isEntryAfterCursor(entry, cursor))
    : filtered;

  const limit = params.limit ?? afterCursor.length;
  const limited = afterCursor.slice(0, limit);

  const hasMore = limited.length > 0 && afterCursor.length > limited.length;
  const nextCursor = hasMore ? serializeCursor(limited[limited.length - 1]) : null;

  return {
    entries: limited,
    nextCursor,
  };
};

const listUpdatesFromSupabase = async (
  params: ListUpdatesParams,
): Promise<ListUpdatesResult> => {
  const client = requireSupabaseClient();

  const query = client.from(TABLE_NAME).select(SELECT_FIELDS);

  const prepared = applyFilters(query, params);

  const { data, error } = await prepared;

  if (error) {
    throw error;
  }

  const entries = normalizeRows(data as UpdateRow[] | null);

  const nextCursor =
    params.limit && entries.length === params.limit
      ? serializeCursor(entries[entries.length - 1])
      : null;

  return { entries, nextCursor };
};

export const listUpdates = async (
  params: ListUpdatesParams = {},
): Promise<ListUpdatesResult> => {
  try {
    const result = await listUpdatesFromSupabase(params);

    if (!params.cursor && result.entries.length === 0) {
      console.info(
        "Supabase returned no changelog entries. Falling back to bundled dataset.",
      );
      return listUpdatesFromStatic(params);
    }

    return result;
  } catch (error) {
    console.info("Falling back to bundled changelog entries.", error);
    return listUpdatesFromStatic(params);
  }
};

export const upsertUpdate = async (entry: UpdateRecord): Promise<void> => {
  const client = requireSupabaseClient();

  const { error } = await client.from(TABLE_NAME).upsert(entry, {
    onConflict: "id",
  });

  if (error) {
    throw error;
  }
};

export const listUpdatesSince = async (
  timestamp: string,
): Promise<UpdateRecord[]> => {
  const client = requireSupabaseClient();

  const { data, error } = await client
    .from(TABLE_NAME)
    .select(SELECT_FIELDS)
    .gte("timestamp", timestamp)
    .order("timestamp", { ascending: false });

  if (error) {
    throw error;
  }

  return normalizeRows(data as UpdateRow[] | null);
};
