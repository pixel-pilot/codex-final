"use client";

import { loadState, saveState, subscribeToState } from "./appStateRepository";

export type StoredUsageLogEntry = {
  id: string;
  rowId: string;
  timestamp: string;
  model: string;
  modelId: string;
  webSearchEnabled: boolean;
  rateLimitPerMinute: number;
  status: string;
  retries: number;
  input: string;
  inputPreview: string;
  inputCharacters: number;
  output: string;
  outputPreview: string;
  outputCharacters: number;
  len: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  promptCost: number;
  completionCost: number;
  cost: number;
  lastUpdated: string;
  errorStatus: string;
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  repetitionPenalty: number | null;
  reasoningLevel: "off" | "standard" | "deep";
};

const USAGE_LOG_KEY = "usage_log";

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const UNIT_TOKEN_COST = 0.000002;

const coerceNumber = (value: unknown, fallback: number): number => {
  if (!isFiniteNumber(value)) {
    return fallback;
  }

  return value as number;
};

const coerceNullableNumber = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return value as number;
};

const coerceString = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

const coerceReasoningLevel = (value: unknown): "off" | "standard" | "deep" => {
  if (value === "standard" || value === "deep") {
    return value;
  }

  return "off";
};

const sanitizeUsageLog = (entries: unknown): StoredUsageLogEntry[] => {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return null;
      }

      const entry = candidate as Partial<StoredUsageLogEntry> & Record<string, unknown>;

      const id = coerceString(entry.id, "").trim();
      const rowId = coerceString(entry.rowId, "").trim();
      const timestamp = coerceString(entry.timestamp, "").trim();

      if (!id || !rowId || !timestamp) {
        return null;
      }

      const input = coerceString(entry.input, "");
      const output = coerceString(entry.output, "");
      const inputTokens = coerceNumber(entry.inputTokens, 0);
      const outputTokens = coerceNumber(entry.outputTokens, 0);
      const promptCost = coerceNumber(entry.promptCost, inputTokens * UNIT_TOKEN_COST);
      const completionCost = coerceNumber(
        entry.completionCost,
        outputTokens * UNIT_TOKEN_COST,
      );
      const totalCost = coerceNumber(entry.cost, promptCost + completionCost);
      const rateLimit = coerceNumber(entry.rateLimitPerMinute, 0);

      return {
        id,
        rowId,
        timestamp,
        model: coerceString(entry.model, coerceString(entry.modelId, "unknown-model")),
        modelId: coerceString(entry.modelId, coerceString(entry.model, "unknown-model")),
        webSearchEnabled: Boolean(entry.webSearchEnabled),
        rateLimitPerMinute: rateLimit > 0 ? rateLimit : 0,
        status: coerceString(entry.status, "Complete"),
        retries: Number.isInteger(entry.retries) ? (entry.retries as number) : 0,
        input,
        inputPreview: coerceString(entry.inputPreview, input.slice(0, 80)),
        inputCharacters: coerceNumber(entry.inputCharacters, input.length),
        output,
        outputPreview: coerceString(entry.outputPreview, output.slice(0, 80)),
        outputCharacters: coerceNumber(entry.outputCharacters, output.length),
        len: typeof entry.len === "number" && Number.isFinite(entry.len) ? entry.len : null,
        inputTokens,
        outputTokens,
        totalTokens: coerceNumber(entry.totalTokens, inputTokens + outputTokens),
        promptCost,
        completionCost,
        cost: totalCost,
        lastUpdated: coerceString(entry.lastUpdated, timestamp),
        errorStatus: coerceString(entry.errorStatus, ""),
        maxTokens: coerceNullableNumber(entry.maxTokens),
        temperature: coerceNullableNumber(entry.temperature),
        topP: coerceNullableNumber(entry.topP),
        topK: coerceNullableNumber(entry.topK),
        repetitionPenalty: coerceNullableNumber(entry.repetitionPenalty),
        reasoningLevel: coerceReasoningLevel(entry.reasoningLevel),
      } satisfies StoredUsageLogEntry;
    })
    .filter((entry): entry is StoredUsageLogEntry => Boolean(entry));
};

export const loadUsageLog = async (): Promise<StoredUsageLogEntry[]> => {
  const stored = await loadState<unknown>(USAGE_LOG_KEY);
  return sanitizeUsageLog(stored);
};

export const saveUsageLog = async (
  entries: StoredUsageLogEntry[],
): Promise<void> => {
  await saveState(USAGE_LOG_KEY, entries);
};

export const subscribeToUsageLog = (
  handler: (entries: StoredUsageLogEntry[]) => void,
): (() => void) =>
  subscribeToState<unknown>(USAGE_LOG_KEY, (payload) => {
    handler(sanitizeUsageLog(payload));
  });
