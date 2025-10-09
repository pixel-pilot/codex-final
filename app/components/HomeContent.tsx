"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CoreGrid, {
  INITIAL_ROW_COUNT,
  GridRow,
  createInitialRows,
  ensureRowInitialized,
  ColumnWidths,
  DEFAULT_COLUMN_WIDTHS,
} from "./CoreGrid";
import SettingsPanel from "./SettingsPanel";

type TabId = "generate" | "settings" | "usage";

const TABS: { id: TabId; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "settings", label: "Settings" },
  { id: "usage", label: "Usage & Costs" },
];

type UsageEntry = {
  id: string;
  rowId: string;
  inputPreview: string;
  outputPreview: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  timestamp: string;
};

type ErrorLogEntry = {
  id: string;
  rowId: string;
  message: string;
  timestamp: string;
  retries: number;
};

type GridFilters = {
  input: string;
  output: string;
  lenMin: string;
  lenMax: string;
};

const ROW_STORAGE_KEY = "reactive-ai-spreadsheet-rows";
const COLUMN_WIDTH_STORAGE_KEY = "reactive-ai-spreadsheet-column-widths";
const ERROR_LOG_STORAGE_KEY = "reactive-ai-spreadsheet-error-log";
const MAX_ERROR_LOG_ENTRIES = 80;

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
  const [dateRange, setDateRange] = useState("last30");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(ROW_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((entry) => (entry ? ensureRowInitialized(entry as GridRow) : null))
            .filter((row): row is GridRow => Boolean(row));

          setRows(normalized);
        }
      }
    } catch (error) {
      console.error("Unable to restore grid rows", error);
    } finally {
      setRowsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ColumnWidths> | null;
        if (parsed && typeof parsed === "object") {
          setColumnWidths((previous) => ({ ...previous, ...parsed }));
        }
      }
    } catch (error) {
      console.error("Unable to restore column widths", error);
    } finally {
      setColumnWidthsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(ERROR_LOG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }

              const candidate = entry as Partial<ErrorLogEntry>;
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
                } as ErrorLogEntry;
              }

              return null;
            })
            .filter((entry): entry is ErrorLogEntry => Boolean(entry));
          if (normalized.length) {
            setErrorLog(normalized.slice(0, MAX_ERROR_LOG_ENTRIES));
          }
        }
      }
    } catch (error) {
      console.error("Unable to restore error log", error);
    } finally {
      setErrorLogHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!rowsHydrated || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(rows));
    } catch (error) {
      console.error("Unable to persist grid rows", error);
    }
  }, [rows, rowsHydrated]);

  useEffect(() => {
    if (!columnWidthsHydrated || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        COLUMN_WIDTH_STORAGE_KEY,
        JSON.stringify(columnWidths),
      );
    } catch (error) {
      console.error("Unable to persist column widths", error);
    }
  }, [columnWidths, columnWidthsHydrated]);

  useEffect(() => {
    if (!errorLogHydrated || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(errorLog));
    } catch (error) {
      console.error("Unable to persist error log", error);
    }
  }, [errorLog, errorLogHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ROW_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) {
            const normalized = parsed
              .map((entry) => (entry ? ensureRowInitialized(entry as GridRow) : null))
              .filter((row): row is GridRow => Boolean(row));
            setRows(normalized);
          }
        } catch (error) {
          console.error("Unable to sync grid rows", error);
        }
      } else if (event.key === COLUMN_WIDTH_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as Partial<ColumnWidths> | null;
          if (parsed && typeof parsed === "object") {
            setColumnWidths((previous) => ({ ...previous, ...parsed }));
          }
        } catch (error) {
          console.error("Unable to sync column widths", error);
        }
      } else if (event.key === ERROR_LOG_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) {
            const normalized = parsed
              .map((entry) => {
                if (!entry || typeof entry !== "object") {
                  return null;
                }

                const candidate = entry as Partial<ErrorLogEntry>;
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
                  } as ErrorLogEntry;
                }

                return null;
              })
              .filter((entry): entry is ErrorLogEntry => Boolean(entry));
            setErrorLog(normalized.slice(0, MAX_ERROR_LOG_ENTRIES));
          }
        } catch (error) {
          console.error("Unable to sync error log", error);
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
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

    const entries = rows
      .filter((row) => row.status === "Complete" && (row.input || row.output))
      .map((row) => {
        const timestamp = row.lastUpdated ? Date.parse(row.lastUpdated) : NaN;
        return { row, timestamp };
      })
      .filter(({ timestamp }) => !Number.isNaN(timestamp))
      .filter(({ timestamp }) => {
        if (rangeSelection.rangeStart !== null && timestamp < rangeSelection.rangeStart) {
          return false;
        }
        if (rangeSelection.rangeEnd !== null && timestamp > rangeSelection.rangeEnd) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100)
      .map(({ row }, index) => ({
        id: `${row.rowId}-${index}`,
        rowId: row.rowId,
        inputPreview: row.input.slice(0, 80),
        outputPreview: row.output.slice(0, 80),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cost: row.costPerOutput,
        model: "gpt-4-turbo",
        timestamp: row.lastUpdated || createTimestamp(),
      }));

    return entries;
  }, [rangeSelection, rows]);

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

    const interval = window.setInterval(() => {
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
    }, 2500);

    return () => window.clearInterval(interval);
  }, [setRows, systemActive, setErrorLog]);

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
              disabled={!selectedCount}
            >
              Clear input
            </button>
            <button
              type="button"
              className="grid-action-button"
              onClick={handleClearSelectedOutputs}
              disabled={!selectedCount}
            >
              Clear output
            </button>
            <button
              type="button"
              className="grid-action-button grid-action-button--danger"
              onClick={handleDeleteSelectedRows}
              disabled={!selectedCount}
            >
              Delete rows
            </button>
            <button
              type="button"
              className="grid-action-button"
              onClick={handleClearSelection}
              disabled={!selectedCount}
            >
              Reset selection
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
                  <th scope="col">Input tokens</th>
                  <th scope="col">Output tokens</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usageEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="usage-log__empty">
                      {rangeSelection.rangeError
                        ? "Adjust the custom range to see usage entries."
                        : "No completed generations yet. Turn the system on from the Generate tab to start producing outputs."}
                    </td>
                  </tr>
                ) : (
                  usageEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td>{entry.model}</td>
                      <td>{entry.inputPreview || "—"}</td>
                      <td>{entry.outputPreview || "—"}</td>
                      <td className="numeric">{entry.inputTokens.toLocaleString()}</td>
                      <td className="numeric">{entry.outputTokens.toLocaleString()}</td>
                      <td className="numeric">${entry.cost.toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
    </main>
  );
}
