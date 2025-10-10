"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CoreGrid, {
  INITIAL_ROW_COUNT,
  GridRow,
  createInitialRows,
  ensureRowInitialized,
  ColumnWidths,
  DEFAULT_COLUMN_WIDTHS,
} from "./CoreGrid";
import SettingsPanel from "./SettingsPanel";
import UpdatesPanel from "./UpdatesPanel";
import {
  loadGridRows,
  loadColumnWidths,
  loadErrorLog,
  saveColumnWidths,
  saveErrorLog,
  saveGridRows,
  StoredErrorLogEntry,
  subscribeToColumnWidths,
  subscribeToErrorLog,
  subscribeToGridRows,
} from "../../lib/gridRepository";
import {
  loadSettingsState,
  subscribeToSettingsState,
  loadModelCatalog,
  subscribeToModelCatalog,
  type PersistedSettingsState,
  type PersistedModelCatalog,
} from "../../lib/settingsRepository";
import {
  loadUsageLog,
  saveUsageLog,
  StoredUsageLogEntry,
  subscribeToUsageLog,
} from "../../lib/usageLogRepository";

type TabId = "generate" | "settings" | "usage" | "updates";

const TABS: { id: TabId; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "settings", label: "Settings" },
  { id: "usage", label: "Usage & Costs" },
  { id: "updates", label: "Updates" },
];

type UsageEntry = StoredUsageLogEntry;

type ErrorLogEntry = StoredErrorLogEntry;

type GridFilters = {
  input: string;
  output: string;
  lenMin: string;
  lenMax: string;
};

const DEFAULT_RATE_LIMIT = 120;
const MAX_ERROR_LOG_ENTRIES = 80;
const MAX_USAGE_LOG_ENTRIES = 500;
const QA_REPORT_ENDPOINT = "/qa/latest.json";
const QA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_MODEL_ID = "gpt-4-turbo";

type SettingsSnapshot = {
  modelId: string;
  modelLabel: string;
  webSearchEnabled: boolean;
  maxTokens: number | null;
  temperature: number | null;
  repetitionPenalty: number | null;
  topP: number | null;
  topK: number | null;
  reasoningLevel: "off" | "standard" | "deep";
  rateLimitPerMinute: number;
};

type QaCoverage = {
  statements: number | null;
  branches: number | null;
  functions: number | null;
  lines: number | null;
};

type QaReport = {
  generatedAt: string;
  coverage: QaCoverage | null;
  note?: string;
};

type QaStatusState =
  | { state: "loading"; report: QaReport | null; error: null }
  | { state: "loaded"; report: QaReport | null; error: null }
  | { state: "error"; report: null; error: string };

const createTimestamp = () => new Date().toISOString();

const countTokens = (value: string) => {
  if (!value) {
    return 0;
  }

  return Math.max(1, Math.ceil(value.trim().split(/\s+/).length * 1.15));
};

const computeCost = (inputTokens: number, outputTokens: number) => {
  const totalTokens = inputTokens + outputTokens;
  const unitCost = 0.000002;

  return Number((totalTokens * unitCost).toFixed(4));
};

const clampRateLimit = (value: number | "" | null | undefined): number => {
  if (value === "") {
    return DEFAULT_RATE_LIMIT;
  }

  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return DEFAULT_RATE_LIMIT;
  }

  return Math.min(Math.max(Math.round(value), 1), 250);
};

const sanitizeNumericPreference = (value: number | "" | null | undefined): number | null => {
  if (value === "") {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const formatNullableNumber = (
  value: number | null,
  options: Intl.NumberFormatOptions & { fallback?: string } = { maximumFractionDigits: 2 },
) => {
  if (value === null) {
    return options.fallback ?? "—";
  }

  const formatter = new Intl.NumberFormat(undefined, options);
  return formatter.format(value);
};

const applyDerivedMetrics = (row: GridRow): GridRow => {
  const inputTokens = countTokens(row.input);
  const outputTokens = countTokens(row.output);
  const costPerOutput = computeCost(inputTokens, outputTokens);
  const len = row.input ? row.input.length : row.output ? row.output.length : null;

  return {
    ...row,
    inputTokens,
    outputTokens,
    costPerOutput,
    len,
  };
};

const parseNumericFilter = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
};

const sortUsageEntries = (entries: UsageEntry[]): UsageEntry[] => {
  return [...entries].sort((a, b) => {
    const right = Date.parse(b.timestamp);
    const left = Date.parse(a.timestamp);

    if (Number.isNaN(right) && Number.isNaN(left)) {
      return 0;
    }
    if (Number.isNaN(right)) {
      return 1;
    }
    if (Number.isNaN(left)) {
      return -1;
    }

    return right - left;
  });
};

const normalizeUsageLogEntries = (entries: UsageEntry[]): UsageEntry[] => {
  return sortUsageEntries(entries).slice(0, MAX_USAGE_LOG_ENTRIES);
};

const seedRows = (): GridRow[] => {
  const base = createInitialRows(INITIAL_ROW_COUNT);

  if (!base.length) {
    return base;
  }

  const now = new Date();
  const iso = now.toISOString();
  const examples: Array<Partial<GridRow>> = [
    {
      status: "Complete",
      input: "Summarize the attached product manual into three key takeaways.",
      output:
        "1. Highlight safety lock usage. 2. Outline maintenance cadence. 3. Share escalation contacts for faults.",
      lastUpdated: iso,
      errorStatus: "",
    },
    {
      status: "In Progress",
      input: "Rewrite this paragraph for executive tone.",
      output: "",
      lastUpdated: iso,
      errorStatus: "",
    },
    {
      status: "Pending",
      input: "Draft an outreach email introducing the beta analytics dashboard.",
      output: "",
      lastUpdated: iso,
      errorStatus: "",
    },
  ];

  const next = [...base];

  for (let i = 0; i < examples.length && i < next.length; i += 1) {
    next[i] = ensureRowInitialized({ ...next[i], ...examples[i] });
  }

  return next;
};

export default function HomeContent() {
  const [activeTab, setActiveTab] = useState<TabId>("generate");
  const [systemActive, setSystemActive] = useState(false);
  const [rows, setRows] = useState<GridRow[]>(() => seedRows());
  const [rowsHydrated, setRowsHydrated] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({
    ...DEFAULT_COLUMN_WIDTHS,
  });
  const [columnWidthsHydrated, setColumnWidthsHydrated] = useState(false);
  const [gridFilters, setGridFilters] = useState<GridFilters>({
    input: "",
    output: "",
    lenMin: "",
    lenMax: "",
  });
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const [errorLogHydrated, setErrorLogHydrated] = useState(false);
  const [usageLog, setUsageLog] = useState<UsageEntry[]>([]);
  const [usageLogHydrated, setUsageLogHydrated] = useState(false);
  const [dateRange, setDateRange] = useState("last30");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(DEFAULT_RATE_LIMIT);
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshot>({
    modelId: DEFAULT_MODEL_ID,
    modelLabel: DEFAULT_MODEL_ID,
    webSearchEnabled: false,
    maxTokens: null,
    temperature: null,
    repetitionPenalty: null,
    topP: null,
    topK: null,
    reasoningLevel: "off",
    rateLimitPerMinute: DEFAULT_RATE_LIMIT,
  });
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [qaStatus, setQaStatus] = useState<QaStatusState>({
    state: "loading",
    report: null,
    error: null,
  });
  const lastPersistedRows = useRef<string | null>(null);
  const lastPersistedWidths = useRef<string | null>(null);
  const lastPersistedErrorLog = useRef<string | null>(null);
  const lastPersistedUsageLog = useRef<string | null>(null);
  const settingsPayloadRef = useRef<PersistedSettingsState | null>(null);
  const modelLabelsRef = useRef<Record<string, string>>({});
  const deriveModelLabel = useCallback((modelId: string | null) => {
    if (!modelId) {
      return DEFAULT_MODEL_ID;
    }

    const trimmed = modelId.trim();
    if (!trimmed) {
      return DEFAULT_MODEL_ID;
    }

    return modelLabelsRef.current[trimmed] ?? trimmed;
  }, []);
  const updateSettingsSnapshot = useCallback(
    (payload: PersistedSettingsState | null) => {
      settingsPayloadRef.current = payload;

      const nextRateLimit = clampRateLimit(payload?.rateLimitPerMinute);
      setRateLimitPerMinute(nextRateLimit);

      const selectedModelId =
        payload?.selectedModelId && payload.selectedModelId.trim()
          ? payload.selectedModelId
          : DEFAULT_MODEL_ID;

      setSettingsSnapshot({
        modelId: selectedModelId,
        modelLabel: deriveModelLabel(selectedModelId),
        webSearchEnabled: Boolean(payload?.webSearchEnabled),
        maxTokens: sanitizeNumericPreference(payload?.maxTokens),
        temperature: sanitizeNumericPreference(payload?.temperature),
        repetitionPenalty: sanitizeNumericPreference(payload?.repetitionPenalty),
        topP: sanitizeNumericPreference(payload?.topP),
        topK: sanitizeNumericPreference(payload?.topK),
        reasoningLevel:
          payload?.reasoningLevel === "standard" || payload?.reasoningLevel === "deep"
            ? payload.reasoningLevel
            : "off",
        rateLimitPerMinute: nextRateLimit,
      });
    },
    [deriveModelLabel],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrateRows = async () => {
      try {
        const stored = await loadGridRows();
        if (!cancelled && stored.length) {
          setRows(stored);
          lastPersistedRows.current = JSON.stringify(stored);
        }
      } catch (error) {
        console.error("Unable to restore grid rows", error);
      } finally {
        if (!cancelled) {
          setRowsHydrated(true);
        }
      }
    };

    hydrateRows();
    const unsubscribe = subscribeToGridRows((stored) => {
      if (cancelled) {
        return;
      }

      const serialized = JSON.stringify(stored);
      if (lastPersistedRows.current === serialized) {
        return;
      }

      lastPersistedRows.current = serialized;
      setRows(stored.length ? stored : seedRows());
      setRowsHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const hydrateSettings = async () => {
      try {
        const stored = await loadSettingsState();
        if (!cancelled) {
          updateSettingsSnapshot(stored);
        }
      } catch (error) {
        console.error("Unable to hydrate settings snapshot", error);
      }
    };

    hydrateSettings();
    const unsubscribe = subscribeToSettingsState((payload) => {
      if (cancelled) {
        return;
      }
      updateSettingsSnapshot(payload);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [updateSettingsSnapshot]);

  useEffect(() => {
    modelLabelsRef.current = modelLabels;
    updateSettingsSnapshot(settingsPayloadRef.current);
  }, [modelLabels, updateSettingsSnapshot]);

  useEffect(() => {
    let cancelled = false;

    const extractLabels = (payload: PersistedModelCatalog | null) => {
      if (!payload || !Array.isArray(payload.models)) {
        return {} as Record<string, string>;
      }

      return payload.models.reduce<Record<string, string>>((accumulator, model) => {
        if (!model || typeof model !== "object") {
          return accumulator;
        }

        const identifier = typeof model.id === "string" ? model.id.trim() : "";
        if (!identifier) {
          return accumulator;
        }

        const label = typeof model.name === "string" && model.name.trim() ? model.name : identifier;
        accumulator[identifier] = label;
        return accumulator;
      }, {});
    };

    const hydrateModelCatalog = async () => {
      try {
        const stored = await loadModelCatalog();
        if (!cancelled) {
          setModelLabels(extractLabels(stored));
        }
      } catch (error) {
        console.error("Unable to restore cached model catalog", error);
      }
    };

    hydrateModelCatalog();
    const unsubscribe = subscribeToModelCatalog((payload) => {
      if (cancelled) {
        return;
      }
      setModelLabels(extractLabels(payload));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateColumnWidths = async () => {
      try {
        const stored = await loadColumnWidths();
        if (!cancelled && Object.keys(stored).length) {
          setColumnWidths((previous) => ({ ...previous, ...stored }));
          lastPersistedWidths.current = JSON.stringify({ ...columnWidths, ...stored });
        }
      } catch (error) {
        console.error("Unable to restore column widths", error);
      } finally {
        if (!cancelled) {
          setColumnWidthsHydrated(true);
        }
      }
    };

    hydrateColumnWidths();

    const unsubscribe = subscribeToColumnWidths((stored) => {
      if (cancelled) {
        return;
      }

      const serialized = JSON.stringify(stored);
      if (lastPersistedWidths.current === serialized) {
        return;
      }

      lastPersistedWidths.current = serialized;
      setColumnWidths((previous) => ({ ...previous, ...stored }));
      setColumnWidthsHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateErrorLog = async () => {
      try {
        const stored = await loadErrorLog();
        if (!cancelled && stored.length) {
          const normalized = stored.slice(0, MAX_ERROR_LOG_ENTRIES);
          setErrorLog(normalized);
          lastPersistedErrorLog.current = JSON.stringify(normalized);
        }
      } catch (error) {
        console.error("Unable to restore error log", error);
      } finally {
        if (!cancelled) {
          setErrorLogHydrated(true);
        }
      }
    };

    hydrateErrorLog();

    const unsubscribe = subscribeToErrorLog((stored) => {
      if (cancelled) {
        return;
      }

      const normalized = stored.slice(0, MAX_ERROR_LOG_ENTRIES);
      const serialized = JSON.stringify(normalized);
      if (lastPersistedErrorLog.current === serialized) {
        return;
      }

      lastPersistedErrorLog.current = serialized;
      setErrorLog(normalized);
      setErrorLogHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateUsageLog = async () => {
      try {
        const stored = await loadUsageLog();
        if (!cancelled) {
          const normalized = normalizeUsageLogEntries(stored);
          setUsageLog(normalized);
          lastPersistedUsageLog.current = JSON.stringify(normalized);
        }
      } catch (error) {
        console.error("Unable to restore usage log", error);
      } finally {
        if (!cancelled) {
          setUsageLogHydrated(true);
        }
      }
    };

    hydrateUsageLog();

    const unsubscribe = subscribeToUsageLog((stored) => {
      if (cancelled) {
        return;
      }

      const normalized = normalizeUsageLogEntries(stored);
      const serialized = JSON.stringify(normalized);
      if (lastPersistedUsageLog.current === serialized) {
        setUsageLogHydrated(true);
        return;
      }

      lastPersistedUsageLog.current = serialized;
      setUsageLog(normalized);
      setUsageLogHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const loadQaReport = async () => {
      try {
        const response = await fetch(QA_REPORT_ENDPOINT, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as QaReport;
        if (!cancelled) {
          setQaStatus({ state: "loaded", report: payload, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setQaStatus({
            state: "error",
            report: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load QA report.",
          });
        }
      }
    };

    setQaStatus({ state: "loading", report: null, error: null });
    loadQaReport();
    const interval = window.setInterval(loadQaReport, QA_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setSelectedRowIds((previous) => {
      if (!previous.size) {
        return previous;
      }

      const validIds = new Set(rows.map((row) => row.rowId));
      let mutated = false;
      const next = new Set<string>();
      previous.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          mutated = true;
        }
      });

      return mutated ? next : previous;
    });
  }, [rows]);

  useEffect(() => {
    if (!rowsHydrated) {
      return;
    }

    const serialized = JSON.stringify(rows);
    if (lastPersistedRows.current === serialized) {
      return;
    }

    lastPersistedRows.current = serialized;

    const persist = async () => {
      try {
        await saveGridRows(rows);
      } catch (error) {
        console.error("Unable to persist grid rows", error);
      }
    };

    void persist();
  }, [rows, rowsHydrated]);

  useEffect(() => {
    if (!columnWidthsHydrated) {
      return;
    }

    const serialized = JSON.stringify(columnWidths);
    if (lastPersistedWidths.current === serialized) {
      return;
    }

    lastPersistedWidths.current = serialized;

    const persist = async () => {
      try {
        await saveColumnWidths(columnWidths);
      } catch (error) {
        console.error("Unable to persist column widths", error);
      }
    };

    void persist();
  }, [columnWidths, columnWidthsHydrated]);

  useEffect(() => {
    if (!errorLogHydrated) {
      return;
    }

    const normalized = errorLog.slice(0, MAX_ERROR_LOG_ENTRIES);
    const serialized = JSON.stringify(normalized);
    if (lastPersistedErrorLog.current === serialized) {
      return;
    }

    lastPersistedErrorLog.current = serialized;

    const persist = async () => {
      try {
        await saveErrorLog(normalized as StoredErrorLogEntry[]);
      } catch (error) {
        console.error("Unable to persist error log", error);
      }
    };

    void persist();
  }, [errorLog, errorLogHydrated]);

  useEffect(() => {
    if (!usageLogHydrated) {
      return;
    }

    const normalized = normalizeUsageLogEntries(usageLog);
    const serialized = JSON.stringify(normalized);
    if (lastPersistedUsageLog.current === serialized) {
      return;
    }

    lastPersistedUsageLog.current = serialized;

    const persist = async () => {
      try {
        await saveUsageLog(normalized);
      } catch (error) {
        console.error("Unable to persist usage log", error);
      }
    };

    void persist();
  }, [usageLog, usageLogHydrated]);

  useEffect(() => {
    if (!rowsHydrated || !usageLogHydrated) {
      return;
    }

    setUsageLog((previous) => {
      const knownIds = new Set(previous.map((entry) => entry.id));
      const additions: UsageEntry[] = [];

      rows.forEach((candidate) => {
        const normalized = ensureRowInitialized(candidate);
        if (normalized.status !== "Complete") {
          return;
        }

        if (!normalized.input && !normalized.output) {
          return;
        }

        const hasTimestamp =
          Boolean(normalized.lastUpdated) && !Number.isNaN(Date.parse(normalized.lastUpdated));
        const timestamp = hasTimestamp ? normalized.lastUpdated : createTimestamp();
        const identifier = hasTimestamp
          ? `${normalized.rowId}::${normalized.lastUpdated}`
          : `${normalized.rowId}::${normalized.retries}-${normalized.inputTokens}-${normalized.outputTokens}-${normalized.costPerOutput}`;

        if (knownIds.has(identifier)) {
          return;
        }

        const promptCost = computeCost(normalized.inputTokens, 0);
        const completionCost = computeCost(0, normalized.outputTokens);
        const totalCost = computeCost(normalized.inputTokens, normalized.outputTokens);
        const totalTokens = normalized.inputTokens + normalized.outputTokens;

        additions.push({
          id: identifier,
          rowId: normalized.rowId,
          timestamp,
          model: settingsSnapshot.modelLabel,
          modelId: settingsSnapshot.modelId,
          webSearchEnabled: settingsSnapshot.webSearchEnabled,
          rateLimitPerMinute: settingsSnapshot.rateLimitPerMinute,
          status: normalized.status,
          retries: normalized.retries,
          input: normalized.input,
          inputPreview: normalized.input.slice(0, 80),
          inputCharacters: normalized.input.length,
          output: normalized.output,
          outputPreview: normalized.output.slice(0, 80),
          outputCharacters: normalized.output.length,
          len: normalized.len,
          inputTokens: normalized.inputTokens,
          outputTokens: normalized.outputTokens,
          totalTokens,
          promptCost,
          completionCost,
          cost: totalCost,
          lastUpdated: normalized.lastUpdated,
          errorStatus: normalized.errorStatus,
          maxTokens: settingsSnapshot.maxTokens,
          temperature: settingsSnapshot.temperature,
          topP: settingsSnapshot.topP,
          topK: settingsSnapshot.topK,
          repetitionPenalty: settingsSnapshot.repetitionPenalty,
          reasoningLevel: settingsSnapshot.reasoningLevel,
        });
      });

      if (!additions.length) {
        return previous;
      }

      return normalizeUsageLogEntries([...additions, ...previous]);
    });
  }, [rows, rowsHydrated, usageLogHydrated, settingsSnapshot]);

  const displayedRowIndices = useMemo(() => {
    const inputFilter = gridFilters.input.trim().toLowerCase();
    const outputFilter = gridFilters.output.trim().toLowerCase();
    const lenMin = parseNumericFilter(gridFilters.lenMin);
    const lenMax = parseNumericFilter(gridFilters.lenMax);

    return rows.reduce<number[]>((accumulator, row, index) => {
      const normalized = ensureRowInitialized(row);
      const normalizedLen = normalized.len ?? 0;
      if (
        (inputFilter && !normalized.input.toLowerCase().includes(inputFilter)) ||
        (outputFilter && !normalized.output.toLowerCase().includes(outputFilter)) ||
        (lenMin !== null && normalizedLen < lenMin) ||
        (lenMax !== null && normalizedLen > lenMax)
      ) {
        return accumulator;
      }

      accumulator.push(index);
      return accumulator;
    }, []);
  }, [gridFilters, rows]);

  const handleFilterChange = useCallback((field: keyof GridFilters, value: string) => {
    setGridFilters((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleColumnWidthChange = useCallback(
    (columnId: keyof ColumnWidths, width: number) => {
      setColumnWidths((previous) => ({ ...previous, [columnId]: width }));
    },
    [],
  );

  const handleToggleRowSelection = useCallback((rowId: string, selected: boolean) => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      if (selected) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback((rowIds: string[], selected: boolean) => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      if (selected) {
        rowIds.forEach((id) => next.add(id));
      } else {
        rowIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedRowIds(() => new Set());
  }, []);

  const handleDeleteSelectedRows = useCallback(() => {
    if (!selectedRowIds.size) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete ${selectedRowIds.size} selected row${selectedRowIds.size === 1 ? "" : "s"}?`,
      );
      if (!confirmed) {
        return;
      }
    }

    const idsToRemove = new Set(selectedRowIds);
    setRows((previous) => previous.filter((row) => !idsToRemove.has(row.rowId)));
    setSelectedRowIds(() => new Set());
  }, [selectedRowIds]);

  const handleClearSelectedInputs = useCallback(() => {
    if (!selectedRowIds.size) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Clear input text for ${selectedRowIds.size} selected row${
          selectedRowIds.size === 1 ? "" : "s"
        }?`,
      );
      if (!confirmed) {
        return;
      }
    }

    const ids = new Set(selectedRowIds);
    setRows((previous) => {
      let mutated = false;
      const next = previous.map((row) => {
        if (!ids.has(row.rowId)) {
          return row;
        }

        mutated = true;
        const updated = applyDerivedMetrics({
          ...row,
          input: "",
          status: "Pending",
          lastUpdated: createTimestamp(),
          errorStatus: "",
        });
        return updated;
      });
      return mutated ? next : previous;
    });
  }, [selectedRowIds]);

  const handleClearSelectedOutputs = useCallback(() => {
    if (!selectedRowIds.size) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Clear output text for ${selectedRowIds.size} selected row${
          selectedRowIds.size === 1 ? "" : "s"
        }?`,
      );
      if (!confirmed) {
        return;
      }
    }

    const ids = new Set(selectedRowIds);
    setRows((previous) => {
      let mutated = false;
      const next = previous.map((row) => {
        if (!ids.has(row.rowId)) {
          return row;
        }

        mutated = true;
        const updated = applyDerivedMetrics({
          ...row,
          output: "",
          status: "Pending",
          lastUpdated: createTimestamp(),
          errorStatus: "",
        });
        return updated;
      });
      return mutated ? next : previous;
    });
  }, [selectedRowIds]);

  const handleClearErrorLog = useCallback(() => {
    if (!errorLog.length) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Clear the recorded error events?");
      if (!confirmed) {
        return;
      }
    }

    setErrorLog([]);
  }, [errorLog.length]);

  const toggleSystem = () => {
    setSystemActive((previous) => !previous);
  };

  const { pending, inProgress, complete, totalCost, percentages, completionRatios } = useMemo(() => {
    let pendingCount = 0;
    let inProgressCount = 0;
    let completeCount = 0;
    let runningCost = 0;

    rows.forEach((row) => {
      const normalized = ensureRowInitialized(row);
      const hasInput = normalized.input.trim().length > 0;

      if (normalized.status === "Pending") {
        if (hasInput) {
          pendingCount += 1;
        }
      } else if (normalized.status === "In Progress") {
        inProgressCount += 1;
      } else if (normalized.status === "Complete") {
        completeCount += 1;
        runningCost += normalized.costPerOutput;
      }
    });

    const aggregateCount = pendingCount + inProgressCount + completeCount;
    const safeTotal = aggregateCount === 0 ? 1 : aggregateCount;
    const toPercent = (value: number) =>
      aggregateCount === 0 ? 0 : Math.round((value / aggregateCount) * 100);

    return {
      pending: pendingCount,
      inProgress: inProgressCount,
      complete: completeCount,
      totalCost: runningCost,
      totalCount: aggregateCount,
      percentages: {
        pending: toPercent(pendingCount),
        inProgress: toPercent(inProgressCount),
        complete: toPercent(completeCount),
      },
      completionRatios: {
        pending: Math.min(1, Math.max(0, 1 - pendingCount / safeTotal)),
        inProgress: Math.min(1, Math.max(0, 1 - inProgressCount / safeTotal)),
        complete: Math.min(1, Math.max(0, aggregateCount === 0 ? 1 : completeCount / safeTotal)),
      },
    };
  }, [rows]);

  const { pending: pendingPercent, inProgress: inProgressPercent, complete: completePercent } = percentages;
  const {
    pending: pendingRatio,
    inProgress: inProgressRatio,
    complete: completeRatio,
  } = completionRatios;

  const metricColors = useMemo(() => {
    const toColor = (ratio: number) => {
      const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
      const hueStart = 0;
      const hueEnd = 142;
      const hue = hueStart + (hueEnd - hueStart) * clamped;
      const saturation = 70;
      const lightness = 42 + 10 * clamped;

      return `hsl(${Math.round(hue)}, ${saturation}%, ${Math.round(lightness)}%)`;
    };

    return {
      pending: toColor(pendingRatio),
      inProgress: toColor(inProgressRatio),
      complete: toColor(completeRatio),
    };
  }, [pendingRatio, inProgressRatio, completeRatio]);

  const rangeSelection = useMemo(() => {
    const now = Date.now();
    let rangeStart: number | null = null;
    let rangeEnd: number | null = now;
    let rangeError: string | null = null;

    if (dateRange === "last7") {
      rangeStart = now - 7 * 24 * 60 * 60 * 1000;
    } else if (dateRange === "last30") {
      rangeStart = now - 30 * 24 * 60 * 60 * 1000;
    } else if (dateRange === "last90") {
      rangeStart = now - 90 * 24 * 60 * 60 * 1000;
    } else if (dateRange === "custom") {
      const startValue = customRange.start ? new Date(customRange.start) : null;
      const endValue = customRange.end ? new Date(customRange.end) : null;

      if (startValue && Number.isNaN(startValue.getTime())) {
        rangeError = "Invalid start date.";
      } else if (endValue && Number.isNaN(endValue.getTime())) {
        rangeError = "Invalid end date.";
      } else {
        if (startValue) {
          rangeStart = startValue.getTime();
        }
        if (endValue) {
          endValue.setHours(23, 59, 59, 999);
          rangeEnd = endValue.getTime();
        }
        if (rangeStart !== null && rangeEnd !== null && rangeStart > rangeEnd) {
          rangeError = "Start date must be before end date.";
        }
      }
    }

    return { rangeStart, rangeEnd, rangeError };
  }, [customRange.end, customRange.start, dateRange]);

  const usageEntries: UsageEntry[] = useMemo(() => {
    if (rangeSelection.rangeError) {
      return [];
    }

    const filtered = usageLog.filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isNaN(timestamp)) {
        return false;
      }

      if (rangeSelection.rangeStart !== null && timestamp < rangeSelection.rangeStart) {
        return false;
      }

      if (rangeSelection.rangeEnd !== null && timestamp > rangeSelection.rangeEnd) {
        return false;
      }

      return true;
    });

    return filtered.slice(0, 100);
  }, [rangeSelection, usageLog]);

  const usageSummary = useMemo(() => {
    return usageEntries.reduce(
      (acc, entry) => {
        acc.totalCost += entry.cost;
        acc.totalInputTokens += entry.inputTokens;
        acc.totalOutputTokens += entry.outputTokens;
        return acc;
      },
      { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 },
    );
  }, [usageEntries]);

  useEffect(() => {
    if (!systemActive) {
      return undefined;
    }

    const limit = Math.min(Math.max(rateLimitPerMinute, 1), 250);
    const intervalMs = Math.max(Math.floor(60000 / limit), 200);

    const runGenerationCycle = () => {
      let failureEntry: ErrorLogEntry | null = null;

      setRows((previous) => {
        const next = [...previous];
        const nowIso = createTimestamp();
        let mutated = false;

        const inProgressIndex = next.findIndex((row) => row.status === "In Progress");
        if (inProgressIndex >= 0) {
          const row = ensureRowInitialized(next[inProgressIndex]);
          const failed = Math.random() < 0.18;
          if (failed) {
            const retries = (row.retries ?? 0) + 1;
            const message = `Generation failed (attempt ${retries})`;
            next[inProgressIndex] = applyDerivedMetrics({
              ...row,
              status: "Error",
              retries,
              errorStatus: message,
              lastUpdated: nowIso,
            });
            failureEntry = {
              id: `${row.rowId}-${retries}-${nowIso}`,
              rowId: row.rowId,
              message,
              timestamp: nowIso,
              retries,
            };
          } else {
            const generatedOutput =
              row.output && row.output.trim()
                ? row.output
                : `Processed: ${row.input.slice(0, 80)}`;
            next[inProgressIndex] = applyDerivedMetrics({
              ...row,
              status: "Complete",
              output: generatedOutput,
              errorStatus: "",
              lastUpdated: nowIso,
            });
          }
          mutated = true;
        } else {
          const retryIndex = next.findIndex(
            (row) => row.status === "Error" && (row.retries ?? 0) < 3,
          );
          if (retryIndex >= 0) {
            const row = ensureRowInitialized(next[retryIndex]);
            next[retryIndex] = applyDerivedMetrics({
              ...row,
              status: "Pending",
              lastUpdated: nowIso,
              errorStatus: row.errorStatus || "Retry scheduled",
            });
            mutated = true;
          } else {
            const pendingIndex = next.findIndex((row) => {
              const normalized = ensureRowInitialized(row);
              return (
                normalized.status === "Pending" && normalized.input.trim().length > 0
              );
            });
            if (pendingIndex >= 0) {
              const row = ensureRowInitialized(next[pendingIndex]);
              next[pendingIndex] = applyDerivedMetrics({
                ...row,
                status: "In Progress",
                lastUpdated: nowIso,
              });
              mutated = true;
            }
          }
        }

        return mutated ? next : previous;
      });

      if (failureEntry) {
        const entry = failureEntry;
        setErrorLog((previousLog) => {
          const nextLog = [entry, ...previousLog];
          return nextLog.slice(0, MAX_ERROR_LOG_ENTRIES);
        });
      }
    };

    runGenerationCycle();
    const interval = window.setInterval(runGenerationCycle, intervalMs);
    return () => window.clearInterval(interval);
  }, [rateLimitPerMinute, setErrorLog, setRows, systemActive]);

  const renderGenerateView = () => {
    const costLabel = systemActive ? "Running cost" : "Completed cost";
    const selectedCount = selectedRowIds.size;
    const visibleRowCount = displayedRowIndices.length;

    return (
      <section className="generate-container" aria-label="AI generation workspace">
        <div className="generate-topline">
          <div className="generate-topline__block">
            <h2 className="generate-topline__title">
              System control <span className="hint-icon">(?)</span>
            </h2>
            <p className="generate-topline__text">
              Toggle the generator when you are ready to process queued rows. Status counters update live so you can
              see what is waiting, running, or finished.
            </p>
          </div>
          <button
            type="button"
            className={`system-toggle${systemActive ? " system-toggle--active" : ""}`}
            onClick={toggleSystem}
            aria-pressed={systemActive}
          >
            <span className="system-toggle__state">{systemActive ? "On" : "Off"}</span>
            <span className="system-toggle__caption">Generation</span>
          </button>
        </div>
        <div className="generate-metrics" role="list">
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">Pending rows</span>
            <span
              className="generate-metric__value"
              style={{ color: metricColors.pending }}
              aria-label={`${pending.toLocaleString()} pending rows representing ${pendingPercent}% of all rows`}
            >
              {pending.toLocaleString()}
              <span className="generate-metric__percentage">• {pendingPercent}%</span>
            </span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">In progress</span>
            <span
              className="generate-metric__value"
              style={{ color: metricColors.inProgress }}
              aria-label={`${inProgress.toLocaleString()} rows in progress representing ${inProgressPercent}% of all rows`}
            >
              {inProgress.toLocaleString()}
              <span className="generate-metric__percentage">• {inProgressPercent}%</span>
            </span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">Completed</span>
            <span
              className="generate-metric__value"
              style={{ color: metricColors.complete }}
              aria-label={`${complete.toLocaleString()} completed rows representing ${completePercent}% of all rows`}
            >
              {complete.toLocaleString()}
              <span className="generate-metric__percentage">• {completePercent}%</span>
            </span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">
              {costLabel} <span className="hint-icon">(?)</span>
            </span>
            <span className="generate-metric__value">${totalCost.toFixed(4)}</span>
          </div>
        </div>
        <div className="grid-operations" aria-label="Grid tools">
          <div className="grid-filters" role="group" aria-label="Filter rows">
            <label>
              <span>Input contains</span>
              <input
                type="search"
                placeholder="Search input text"
                value={gridFilters.input}
                onChange={(event) => handleFilterChange("input", event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Output contains</span>
              <input
                type="search"
                placeholder="Search output text"
                value={gridFilters.output}
                onChange={(event) => handleFilterChange("output", event.currentTarget.value)}
              />
            </label>
            <div className="grid-filter-range" role="group" aria-label="Filter by character length">
              <label>
                <span>Len min</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={gridFilters.lenMin}
                  onChange={(event) => handleFilterChange("lenMin", event.currentTarget.value)}
                />
              </label>
              <label>
                <span>Len max</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={gridFilters.lenMax}
                  onChange={(event) => handleFilterChange("lenMax", event.currentTarget.value)}
                />
              </label>
              <span className="grid-filter-range__meta">{visibleRowCount.toLocaleString()} rows match</span>
            </div>
          </div>
          <div className="grid-actions" role="group" aria-label="Selection actions">
            <span className="grid-actions__selection">{selectedCount} selected</span>
            <button
              type="button"
              className="grid-action-button"
              onClick={handleClearSelectedInputs}
              title="Remove input text from all selected rows."
              aria-label="Clear all inputs. Removes input text from all selected rows."
              disabled={!selectedCount}
            >
              Clear All Inputs
              <span className="grid-action-button__hint" aria-hidden="true">?</span>
            </button>
            <button
              type="button"
              className="grid-action-button"
              onClick={handleClearSelectedOutputs}
              title="Remove generated output from all selected rows."
              aria-label="Clear all outputs. Removes generated output from all selected rows."
              disabled={!selectedCount}
            >
              Clear All Outputs
              <span className="grid-action-button__hint" aria-hidden="true">?</span>
            </button>
            <button
              type="button"
              className="grid-action-button grid-action-button--danger"
              onClick={handleDeleteSelectedRows}
              title="Delete every selected row from the grid."
              aria-label="Delete selected rows. Removes every selected row from the grid."
              disabled={!selectedCount}
            >
              Delete Selected Rows
              <span className="grid-action-button__hint" aria-hidden="true">?</span>
            </button>
            <button
              type="button"
              className="grid-action-button"
              onClick={handleClearSelection}
              title="Deselect all currently highlighted rows."
              aria-label="Deselect all rows. Clears the current selection."
              disabled={!selectedCount}
            >
              Deselect All
              <span className="grid-action-button__hint" aria-hidden="true">?</span>
            </button>
          </div>
        </div>
        <div className="grid-container" aria-label="AI grid workspace">
          <CoreGrid
            rows={rows}
            setRows={setRows}
            displayedRowIndices={displayedRowIndices}
            selectedRowIds={selectedRowIds}
            onToggleRowSelection={handleToggleRowSelection}
            onToggleSelectAll={handleToggleSelectAll}
            columnWidths={columnWidths}
            onColumnWidthChange={handleColumnWidthChange}
          />
        </div>
        {errorLog.length > 0 && (
          <div className="error-log" role="region" aria-label="Generation error log">
            <div className="error-log__header">
              <div>
                <h3>Recent generation errors</h3>
                <p className="error-log__summary">
                  Track retries and investigate rows that stalled. The log keeps the most recent {MAX_ERROR_LOG_ENTRIES} entries.
                </p>
              </div>
              <button
                type="button"
                className="grid-action-button"
                onClick={handleClearErrorLog}
              >
                Clear log
              </button>
            </div>
            <ul className="error-log__list">
              {errorLog.slice(0, 8).map((entry) => (
                <li key={entry.id}>
                  <div className="error-log__message">{entry.message}</div>
                  <div className="error-log__meta">
                    <span className="error-log__meta-item">Row {entry.rowId.slice(0, 8)}</span>
                    <span className="error-log__meta-item">Retries: {entry.retries}</span>
                    <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  };

  const renderUsageView = () => {
    const customRangeError = rangeSelection.rangeError;
    const qaReport = qaStatus.report;
    const coverageEntries: Array<[keyof QaCoverage, number]> = qaReport?.coverage
      ? (Object.entries(qaReport.coverage) as Array<[keyof QaCoverage, number | null]>)
          .filter(([, value]) => value !== null)
          .map(([metric, value]) => [metric, value as number])
      : [];

    return (
      <section className="usage-container" aria-label="Usage history and costs">
        <div className="usage-header">
          <div>
            <h2>
              Usage overview <span className="hint-icon">(?)</span>
            </h2>
            <p>
              Track how many tokens you consumed and what you spent over your selected range.
            </p>
          </div>
          <div className="usage-range-group">
            <label className="usage-range" htmlFor="usage-range">
              Date range <span className="hint-icon">(?)</span>
              <select
                id="usage-range"
                value={dateRange}
                onChange={(event) => setDateRange(event.currentTarget.value)}
              >
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="last90">Last 90 days</option>
                <option value="custom">Custom range…</option>
              </select>
            </label>
            {dateRange === "custom" && (
              <div className="usage-custom-range" role="group" aria-label="Custom date range">
                <label>
                  <span>Start</span>
                  <input
                    type="date"
                    value={customRange.start}
                    onChange={(event) =>
                      setCustomRange((previous) => ({ ...previous, start: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  <span>End</span>
                  <input
                    type="date"
                    value={customRange.end}
                    onChange={(event) =>
                      setCustomRange((previous) => ({ ...previous, end: event.currentTarget.value }))
                    }
                  />
                </label>
              </div>
            )}
            {customRangeError && (
              <p className="usage-range__error" role="alert">
                {customRangeError}
              </p>
            )}
          </div>
        </div>
        <div className="usage-metrics" role="list">
          <div className="usage-metric" role="listitem">
            <span className="usage-metric__label">Total spent</span>
            <span className="usage-metric__value">${usageSummary.totalCost.toFixed(4)}</span>
          </div>
          <div className="usage-metric" role="listitem">
            <span className="usage-metric__label">Total input tokens</span>
            <span className="usage-metric__value">{usageSummary.totalInputTokens.toLocaleString()}</span>
          </div>
          <div className="usage-metric" role="listitem">
            <span className="usage-metric__label">Total output tokens</span>
            <span className="usage-metric__value">{usageSummary.totalOutputTokens.toLocaleString()}</span>
          </div>
          <div className="usage-metric" role="listitem">
            <span className="usage-metric__label">Completed outputs</span>
            <span className="usage-metric__value">{usageEntries.length.toLocaleString()}</span>
          </div>
        </div>
        <div className="usage-log">
          <div className="usage-log__header">
            <h3>
              Usage log <span className="hint-icon">(?)</span>
            </h3>
            <p>Every completed output is recorded with size, model, and cost details.</p>
          </div>
          <div className="usage-log__table" role="region" aria-label="Usage log entries">
            <table>
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Model</th>
                  <th scope="col">Input preview</th>
                  <th scope="col">Output preview</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Characters</th>
                  <th scope="col">Parameters</th>
                  <th scope="col">Costs</th>
                </tr>
              </thead>
              <tbody>
                {usageEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="usage-log__empty">
                      {rangeSelection.rangeError
                        ? "Adjust the custom range to see usage entries."
                        : "No completed generations yet. Turn the system on from the Generate tab to start producing outputs."}
                    </td>
                  </tr>
                ) : (
                  usageEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <time dateTime={entry.timestamp}>
                          {new Date(entry.timestamp).toLocaleString()}
                        </time>
                        <div className="usage-log__subtext">Row {entry.rowId.slice(0, 8)}</div>
                        {entry.lastUpdated && entry.lastUpdated !== entry.timestamp && (
                          <div className="usage-log__subtext">
                            Updated {new Date(entry.lastUpdated).toLocaleString()}
                          </div>
                        )}
                        {entry.retries > 0 && (
                          <div className="usage-log__subtext">Retries: {entry.retries}</div>
                        )}
                      </td>
                      <td>
                        <div>{entry.model}</div>
                        <div className="usage-log__subtext">{entry.modelId}</div>
                        {entry.status && (
                          <div className="usage-log__subtext">Status: {entry.status}</div>
                        )}
                        {entry.errorStatus && (
                          <div className="usage-log__subtext" role="note">
                            {entry.errorStatus}
                          </div>
                        )}
                      </td>
                      <td>{entry.inputPreview || "—"}</td>
                      <td>{entry.outputPreview || "—"}</td>
                      <td className="numeric">
                        <div>In: {entry.inputTokens.toLocaleString()}</div>
                        <div>Out: {entry.outputTokens.toLocaleString()}</div>
                        <div>Total: {entry.totalTokens.toLocaleString()}</div>
                      </td>
                      <td className="numeric">
                        <div>In: {entry.inputCharacters.toLocaleString()}</div>
                        <div>Out: {entry.outputCharacters.toLocaleString()}</div>
                        {entry.len !== null && (
                          <div>Len metric: {entry.len.toLocaleString()}</div>
                        )}
                      </td>
                      <td>
                        <div className="usage-log__subtext">
                          Web search: {entry.webSearchEnabled ? "on" : "off"}
                        </div>
                        <div className="usage-log__subtext">
                          Rate limit: {entry.rateLimitPerMinute > 0
                            ? `${entry.rateLimitPerMinute}/min`
                            : "—"}
                        </div>
                        <div className="usage-log__subtext">
                          Max tokens: {entry.maxTokens !== null ? entry.maxTokens : "—"}
                        </div>
                        <div className="usage-log__subtext">
                          Temperature: {formatNullableNumber(entry.temperature)}
                        </div>
                        <div className="usage-log__subtext">
                          Top P: {formatNullableNumber(entry.topP)}
                        </div>
                        <div className="usage-log__subtext">
                          Top K: {formatNullableNumber(entry.topK, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="usage-log__subtext">
                          Repetition: {formatNullableNumber(entry.repetitionPenalty)}
                        </div>
                        <div className="usage-log__subtext">Reasoning: {entry.reasoningLevel}</div>
                      </td>
                      <td className="numeric">
                        <div>Prompt: ${entry.promptCost.toFixed(4)}</div>
                        <div>Completion: ${entry.completionCost.toFixed(4)}</div>
                        <div>Total: ${entry.cost.toFixed(4)}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <section className="usage-qa-status" aria-label="Automated QA validation status">
          <div className="usage-qa-status__header">
            <h3>Automated QA status</h3>
            {qaReport?.generatedAt && (
              <time dateTime={qaReport.generatedAt}>
                Updated {new Date(qaReport.generatedAt).toLocaleString()}
              </time>
            )}
          </div>
          {qaStatus.state === "loading" && <p>Loading latest QA results…</p>}
          {qaStatus.state === "error" && (
            <p role="alert">Unable to load QA report: {qaStatus.error}</p>
          )}
          {qaStatus.state === "loaded" && (
            <>
              {coverageEntries.length > 0 ? (
                <dl className="usage-qa-status__metrics">
                  {coverageEntries.map(([metric, value]) => (
                    <div key={metric} className="usage-qa-status__metric">
                      <dt>{metric.replace(/^[a-z]/, (char) => char.toUpperCase())}</dt>
                      <dd>{`${value.toFixed(2)}%`}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No coverage metrics were reported.</p>
              )}
              {qaReport?.note && <p className="usage-qa-status__note">{qaReport.note}</p>}
            </>
          )}
        </section>
      </section>
    );
  };

  return (
    <main className="grid-page-shell">
      <div className="grid-heading">
        <div className="grid-heading-text">
          <h1>Reactive AI Spreadsheet</h1>
          <p>
            Configure and orchestrate large-scale AI text processing with a purpose-built, high-performance
            spreadsheet grid. Paste thousands of inputs at once, monitor status at a glance, and keep system-managed
            columns protected from manual edits.
          </p>
        </div>
        <nav className="tab-navigation" aria-label="Primary views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-navigation__button${activeTab === tab.id ? " tab-navigation__button--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      {activeTab === "generate" && renderGenerateView()}
      {activeTab === "settings" && (
        <section className="settings-container" aria-label="Application settings">
          <SettingsPanel />
        </section>
      )}
      {activeTab === "usage" && renderUsageView()}
      {activeTab === "updates" && (
        <section className="updates-container" aria-label="Recent application updates">
          <UpdatesPanel />
        </section>
      )}
    </main>
  );
}
