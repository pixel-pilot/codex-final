"use client";

import type { ColumnWidths, GridRow } from "../app/components/CoreGrid";
import { ensureRowInitialized } from "../app/components/CoreGrid";
import { loadState, saveState, subscribeToState } from "./appStateRepository";

export type StoredErrorLogEntry = {
  id: string;
  rowId: string;
  message: string;
  timestamp: string;
  retries: number;
};

const GRID_ROWS_KEY = "grid_rows";
const GRID_COLUMN_WIDTHS_KEY = "grid_column_widths";
const GRID_ERROR_LOG_KEY = "grid_error_log";

const isGridRow = (candidate: unknown): candidate is GridRow => {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const row = candidate as Partial<GridRow>;
  return typeof row.rowId === "string";
};

const sanitizeRows = (rows: unknown): GridRow[] => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((entry) => (isGridRow(entry) ? ensureRowInitialized(entry) : null))
    .filter((entry): entry is GridRow => Boolean(entry));
};

const isColumnWidths = (candidate: unknown): candidate is Partial<ColumnWidths> => {
  return !!candidate && typeof candidate === "object";
};

const sanitizeErrorLog = (entries: unknown): StoredErrorLogEntry[] => {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<StoredErrorLogEntry>;
      if (
        typeof candidate.id === "string" &&
        typeof candidate.rowId === "string" &&
        typeof candidate.message === "string" &&
        typeof candidate.timestamp === "string"
      ) {
        return {
          id: candidate.id,
          rowId: candidate.rowId,
          message: candidate.message,
          timestamp: candidate.timestamp,
          retries: typeof candidate.retries === "number" ? candidate.retries : 0,
        } satisfies StoredErrorLogEntry;
      }

      return null;
    })
    .filter((entry): entry is StoredErrorLogEntry => Boolean(entry));
};

export const loadGridRows = async (): Promise<GridRow[]> => {
  const stored = await loadState<unknown>(GRID_ROWS_KEY);
  return sanitizeRows(stored);
};

export const saveGridRows = async (rows: GridRow[]): Promise<void> => {
  await saveState(GRID_ROWS_KEY, rows);
};

export const subscribeToGridRows = (
  handler: (rows: GridRow[]) => void,
): (() => void) =>
  subscribeToState<unknown>(GRID_ROWS_KEY, (payload) => {
    handler(sanitizeRows(payload));
  });

export const loadColumnWidths = async (): Promise<Partial<ColumnWidths>> => {
  const stored = await loadState<unknown>(GRID_COLUMN_WIDTHS_KEY);
  if (isColumnWidths(stored)) {
    return stored as Partial<ColumnWidths>;
  }
  return {};
};

export const saveColumnWidths = async (
  widths: Partial<ColumnWidths>,
): Promise<void> => {
  await saveState(GRID_COLUMN_WIDTHS_KEY, widths);
};

export const subscribeToColumnWidths = (
  handler: (widths: Partial<ColumnWidths>) => void,
): (() => void) =>
  subscribeToState<unknown>(GRID_COLUMN_WIDTHS_KEY, (payload) => {
    handler(isColumnWidths(payload) ? (payload as Partial<ColumnWidths>) : {});
  });

export const loadErrorLog = async (): Promise<StoredErrorLogEntry[]> => {
  const stored = await loadState<unknown>(GRID_ERROR_LOG_KEY);
  return sanitizeErrorLog(stored);
};

export const saveErrorLog = async (
  entries: StoredErrorLogEntry[],
): Promise<void> => {
  await saveState(GRID_ERROR_LOG_KEY, entries);
};

export const subscribeToErrorLog = (
  handler: (entries: StoredErrorLogEntry[]) => void,
): (() => void) =>
  subscribeToState<unknown>(GRID_ERROR_LOG_KEY, (payload) => {
    handler(sanitizeErrorLog(payload));
  });
