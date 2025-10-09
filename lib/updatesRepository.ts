import { getSupabaseClient } from "./supabaseClient";

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

export const listUpdates = async (
  params: ListUpdatesParams = {}
): Promise<ListUpdatesResult> => {
  const client = getSupabaseClient();

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

export const upsertUpdate = async (entry: UpdateRecord): Promise<void> => {
  const client = getSupabaseClient();

  const { error } = await client.from(TABLE_NAME).upsert(entry, {
    onConflict: "id",
  });

  if (error) {
    throw error;
  }
};

export const listUpdatesSince = async (timestamp: string): Promise<UpdateRecord[]> => {
  const client = getSupabaseClient();

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
