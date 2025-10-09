"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

export type GridRow = {
  rowId: string;
  retries: number;
  status: string;
  input: string;
  output: string;
  len: number | null;
  lastUpdated: string;
  errorStatus: string;
  inputTokens: number;
  outputTokens: number;
  costPerOutput: number;
};

export const INITIAL_ROW_COUNT = 5000;
const ROW_HEIGHT = 40;
const OVERSCAN = 8;
export const DEFAULT_COLUMN_WIDTHS = {
  select: 48,
  status: 120,
  input: 320,
  output: 320,
  len: 90,
  lastUpdated: 160,
  errorStatus: 180,
  costPerOutput: 150,
} as const;

const MIN_COLUMN_WIDTHS: ColumnWidths = {
  select: 44,
  status: 100,
  input: 220,
  output: 220,
  len: 72,
  lastUpdated: 140,
  errorStatus: 140,
  costPerOutput: 120,
};

export type ColumnId = keyof typeof DEFAULT_COLUMN_WIDTHS;

export type ColumnWidths = Record<ColumnId, number>;

const columnDefinition: Array<{
  id: ColumnId;
  label: string;
  align?: "start" | "center" | "end";
}> = [
  { id: "select", label: "", align: "center" },
  { id: "status", label: "Status" },
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "len", label: "Len", align: "end" },
  { id: "lastUpdated", label: "Last Updated" },
  { id: "errorStatus", label: "Error Status" },
  { id: "costPerOutput", label: "Cost / Output", align: "end" },
];

const generateRowId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const createTimestamp = () => new Date().toISOString();

const calculateTokenCount = (value: string) => {
  if (!value) {
    return 0;
  }

  return Math.max(1, Math.ceil(value.trim().split(/\s+/).length * 1.15));
};

const calculateCost = (inputTokens: number, outputTokens: number) => {
  const totalTokens = inputTokens + outputTokens;
  const unitCost = 0.000002;

  return Number((totalTokens * unitCost).toFixed(4));
};

const withDerivedMetrics = (row: GridRow): GridRow => {
  const inputTokens = calculateTokenCount(row.input);
  const outputTokens = calculateTokenCount(row.output);
  const costPerOutput = calculateCost(inputTokens, outputTokens);
  const len = row.input ? row.input.length : row.output ? row.output.length : null;

  return {
    ...row,
    inputTokens,
    outputTokens,
    costPerOutput,
    len,
  };
};

export const ensureRowInitialized = (row?: GridRow): GridRow => {
  const input = row?.input ?? "";
  const output = row?.output ?? "";
  const inputTokens = row?.inputTokens ?? calculateTokenCount(input);
  const outputTokens = row?.outputTokens ?? calculateTokenCount(output);

  return {
    rowId: row?.rowId?.trim() ? row.rowId : generateRowId(),
    retries: typeof row?.retries === "number" ? row.retries : 0,
    status: row?.status?.trim() ? row.status : "Pending",
    input,
    output,
    len:
      typeof row?.len === "number"
        ? row.len
        : input
            ? input.length
            : output
              ? output.length
              : null,
    lastUpdated: row?.lastUpdated ?? "",
    errorStatus: row?.errorStatus ?? "",
    inputTokens,
    outputTokens,
    costPerOutput: row?.costPerOutput ?? calculateCost(inputTokens, outputTokens),
  };
};

export const createRow = (): GridRow => ensureRowInitialized();

export const createInitialRows = (count: number): GridRow[] =>
  Array.from({ length: count }, () => createRow());

const parseClipboardText = (text: string): string[] => {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n");

  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (!lines.length) {
    return [];
  }

  return lines.map((line) => line.split("\t")[0] ?? "");
};

type CoreGridProps = {
  rows: GridRow[];
  setRows: React.Dispatch<React.SetStateAction<GridRow[]>>;
  displayedRowIndices: number[];
  selectedRowIds: Set<string>;
  onToggleRowSelection: (rowId: string, selected: boolean) => void;
  onToggleSelectAll: (rowIds: string[], selected: boolean) => void;
  columnWidths: ColumnWidths;
  onColumnWidthChange: (columnId: ColumnId, width: number) => void;
};

export function CoreGrid({
  rows,
  setRows,
  displayedRowIndices,
  selectedRowIds,
  onToggleRowSelection,
  onToggleSelectAll,
  columnWidths,
  onColumnWidthChange,
}: CoreGridProps) {
  const totalRowCount = rows.length;
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const resizeStateRef = useRef<{
    columnId: ColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  const normalizedColumnWidths: ColumnWidths = useMemo(() => {
    const resolved: Partial<ColumnWidths> = {};
    for (const { id } of columnDefinition) {
      const candidate = columnWidths[id];
      const min = MIN_COLUMN_WIDTHS[id];
      const fallback = DEFAULT_COLUMN_WIDTHS[id];
      const width = Number.isFinite(candidate) ? Number(candidate) : fallback;
      resolved[id] = Math.max(min, width);
    }
    return resolved as ColumnWidths;
  }, [columnWidths]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setViewportHeight(container.clientHeight);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setScrollTop(container.scrollTop);
  }, []);

  const updateRowRange = useCallback(
    (startIndex: number, values: string[]) => {
      if (!values.length) {
        return;
      }

      setRows((previous) => {
        const requiredLength = startIndex + values.length;
        const next = [...previous];

        for (let i = next.length; i < requiredLength; i += 1) {
          next.push(createRow());
        }

        let mutated = next.length !== previous.length;

        values.forEach((value, offset) => {
          const targetIndex = startIndex + offset;
          const normalized = ensureRowInitialized(next[targetIndex]);
          const nextInput = value ?? "";
          const shouldResetStatus = normalized.input !== nextInput;
          const nextLen = nextInput ? nextInput.length : null;
          const nextTimestamp = shouldResetStatus
            ? createTimestamp()
            : normalized.lastUpdated;
          const updated: GridRow = withDerivedMetrics({
            ...normalized,
            input: nextInput,
            status: shouldResetStatus ? "Pending" : normalized.status,
            len: nextLen,
            lastUpdated: nextTimestamp,
          });

          if (
            shouldResetStatus ||
            normalized.input !== updated.input ||
            normalized.status !== updated.status ||
            normalized.len !== updated.len ||
            normalized.lastUpdated !== updated.lastUpdated ||
            normalized.inputTokens !== updated.inputTokens ||
            normalized.outputTokens !== updated.outputTokens ||
            normalized.costPerOutput !== updated.costPerOutput
          ) {
            mutated = true;
          }

          next[targetIndex] = updated;
        });

        return mutated ? next : previous;
      });
    },
    [setRows],
  );

  const handleInputChange = useCallback(
    (rowIndex: number, value: string) => {
      setRows((previous) => {
        const next = [...previous];

        for (let i = next.length; i <= rowIndex; i += 1) {
          next[i] = next[i] ?? createRow();
        }

        const normalized = ensureRowInitialized(next[rowIndex]);
        const nextInput = value ?? "";
        const shouldResetStatus = normalized.input !== nextInput;
        const nextLen = nextInput ? nextInput.length : null;
        const nextTimestamp = shouldResetStatus
          ? createTimestamp()
          : normalized.lastUpdated;
        const updated: GridRow = withDerivedMetrics({
          ...normalized,
          input: nextInput,
          status: shouldResetStatus ? "Pending" : normalized.status,
          len: nextLen,
          lastUpdated: nextTimestamp,
        });

        const createdRow = rowIndex >= previous.length;

        if (
          !shouldResetStatus &&
          normalized.input === updated.input &&
          normalized.len === updated.len &&
          normalized.lastUpdated === updated.lastUpdated &&
          normalized.inputTokens === updated.inputTokens &&
          normalized.outputTokens === updated.outputTokens &&
          normalized.costPerOutput === updated.costPerOutput &&
          !createdRow
        ) {
          return previous;
        }

        next[rowIndex] = updated;
        return next;
      });
    },
    [setRows],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>, filteredRowIndex: number) => {
      event.preventDefault();
      const clipboardText = event.clipboardData?.getData("text") ?? "";
      const values = parseClipboardText(clipboardText);
      if (!values.length) {
        return;
      }

      const actualIndex =
        displayedRowIndices[filteredRowIndex] ?? Math.max(totalRowCount, 0);
      updateRowRange(actualIndex, values);
      setActiveRow(filteredRowIndex);
    },
    [displayedRowIndices, totalRowCount, updateRowRange],
  );

  const handleFocus = useCallback((filteredRowIndex: number) => {
    setActiveRow(filteredRowIndex);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, filteredRowIndex: number) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const actualIndex =
          displayedRowIndices[filteredRowIndex] ?? totalRowCount - 1;
        setRows((previous) => {
          if (actualIndex >= previous.length - 1) {
            return [...previous, createRow()];
          }

          return previous;
        });
        const nextIndex = Math.min(
          filteredRowIndex + 1,
          Math.max(displayedRowIndices.length - 1, 0),
        );
        setActiveRow(nextIndex);
      } else if (event.key === "ArrowUp") {
        if (filteredRowIndex === 0) {
          return;
        }
        event.preventDefault();
        setActiveRow(Math.max(0, filteredRowIndex - 1));
      }
    },
    [displayedRowIndices, setRows, totalRowCount],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setScrollTop(container.scrollTop);
    }
  }, []);

  const displayedRows = useMemo(() => {
    return displayedRowIndices
      .map((index) => rows[index])
      .filter((row): row is GridRow => Boolean(row))
      .map((row) => ensureRowInitialized(row));
  }, [displayedRowIndices, rows]);

  const gridTemplate = useMemo(() => {
    return columnDefinition
      .map(({ id }) => `${normalizedColumnWidths[id]}px`)
      .join(" ");
  }, [normalizedColumnWidths]);

  const totalHeight = displayedRows.length * ROW_HEIGHT;

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      displayedRows.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );

    return { startIndex: start, endIndex: end };
  }, [displayedRows.length, scrollTop, viewportHeight]);

  const visibleRows = displayedRows.slice(startIndex, endIndex);

  const activeRowId = useMemo(() => {
    if (activeRow == null || activeRow < 0 || activeRow >= displayedRows.length) {
      return null;
    }
    return displayedRows[activeRow]?.rowId ?? null;
  }, [activeRow, displayedRows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (activeRow == null) {
      return;
    }

    const rowTop = activeRow * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const currentScrollTop = container.scrollTop;
    const viewBottom = currentScrollTop + container.clientHeight;

    if (rowTop < currentScrollTop) {
      container.scrollTo({ top: rowTop });
    } else if (rowBottom > viewBottom) {
      container.scrollTo({ top: rowBottom - container.clientHeight });
    }

    const input = activeRowId ? inputRefs.current.get(activeRowId) : null;
    if (input && document.activeElement !== input) {
      requestAnimationFrame(() => {
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
      });
    }
  }, [activeRow, activeRowId]);

  const gridStyle = useMemo(
    () =>
      ({
        "--grid-template-columns": gridTemplate,
        "--grid-row-height": `${ROW_HEIGHT}px`,
      }) as CSSProperties,
    [gridTemplate],
  );

  const isAllVisibleSelected = useMemo(() => {
    if (!displayedRows.length) {
      return false;
    }
    return displayedRows.every((row) => selectedRowIds.has(row.rowId));
  }, [displayedRows, selectedRowIds]);

  const handleResizeStart = useCallback(
    (columnId: ColumnId, event: ReactMouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = normalizedColumnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId];
      resizeStateRef.current = { columnId, startX, startWidth };

      const handleMove = (moveEvent: MouseEvent) => {
        const state = resizeStateRef.current;
        if (!state || state.columnId !== columnId) {
          return;
        }
        const delta = moveEvent.clientX - state.startX;
        const proposed = state.startWidth + delta;
        const min = MIN_COLUMN_WIDTHS[columnId];
        const bounded = Math.max(min, proposed);
        onColumnWidthChange(columnId, Math.round(bounded));
      };

      const handleUp = () => {
        resizeStateRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [normalizedColumnWidths, onColumnWidthChange],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", () => undefined);
      document.removeEventListener("mouseup", () => undefined);
    };
  }, []);

  return (
    <div
      className="grid-table"
      role="grid"
      aria-label="Reactive AI Spreadsheet grid"
      aria-rowcount={displayedRows.length}
      aria-colcount={columnDefinition.length}
      style={gridStyle}
    >
      <div className="grid-header" role="rowgroup">
        <div className="grid-header-row" role="row">
          {columnDefinition.map(({ id, label, align }, index) => (
            <div
              key={id}
              className={`grid-header-cell${align ? ` grid-header-cell--${align}` : ""}`}
              role="columnheader"
              aria-colindex={index + 1}
            >
              {id === "select" ? (
                <input
                  type="checkbox"
                  aria-label="Select all visible rows"
                  checked={isAllVisibleSelected}
                  onChange={(event) =>
                    onToggleSelectAll(
                      displayedRows.map((row) => row.rowId),
                      event.currentTarget.checked,
                    )
                  }
                />
              ) : (
                label
              )}
              <span
                role="separator"
                aria-hidden="true"
                className="grid-resize-handle"
                onMouseDown={(event) => handleResizeStart(id, event)}
              />
            </div>
          ))}
        </div>
      </div>
      <div
        className="grid-body"
        onScroll={handleScroll}
        ref={containerRef}
        role="rowgroup"
      >
        <div className="grid-body-inner" style={{ height: totalHeight }}>
          {visibleRows.map((row, visibleIndex) => {
            const rowIndex = startIndex + visibleIndex;
            const isActive = rowIndex === activeRow;
            const actualRowIndex = displayedRowIndices[rowIndex];
            const toneClass = rowIndex % 2 === 0 ? "grid-row--even" : "grid-row--odd";

            return (
              <div
                key={row.rowId ?? rowIndex}
                className={`grid-row ${toneClass}${
                  isActive ? " grid-row--active" : ""
                }`}
                role="row"
                aria-rowindex={rowIndex + 1}
                style={{ transform: `translateY(${rowIndex * ROW_HEIGHT}px)` }}
              >
                <div className="grid-cell grid-cell--selection" role="gridcell" aria-colindex={1}>
                  <input
                    type="checkbox"
                    aria-label={`Select row ${rowIndex + 1}`}
                    checked={selectedRowIds.has(row.rowId)}
                    onChange={(event) =>
                      onToggleRowSelection(row.rowId, event.currentTarget.checked)
                    }
                  />
                </div>
                <div className="grid-cell read-only-dimmed" role="gridcell" aria-colindex={2}>
                  {row.status}
                </div>
                <div className="grid-cell grid-cell--input" role="gridcell" aria-colindex={3}>
                  <textarea
                    ref={(element) => {
                      if (element) {
                        inputRefs.current.set(row.rowId, element);
                      } else {
                        inputRefs.current.delete(row.rowId);
                      }
                    }}
                    value={row.input}
                    onChange={(event) =>
                      handleInputChange(actualRowIndex, event.currentTarget.value)
                    }
                    onPaste={(event) => handlePaste(event, rowIndex)}
                    onFocus={() => {
                      const filteredIndex = displayedRowIndices.indexOf(actualRowIndex);
                      handleFocus(filteredIndex >= 0 ? filteredIndex : rowIndex);
                    }}
                    onKeyDown={(event) => handleKeyDown(event, rowIndex)}
                    spellCheck={false}
                    aria-label={`Input for row ${rowIndex + 1}`}
                  />
                </div>
                <div className="grid-cell" role="gridcell" aria-colindex={4}>
                  {row.output}
                </div>
                <div className="grid-cell read-only-dimmed" role="gridcell" aria-colindex={5}>
                  {row.len ?? ""}
                </div>
                <div className="grid-cell read-only-dimmed" role="gridcell" aria-colindex={6}>
                  {row.lastUpdated}
                </div>
                <div className="grid-cell read-only-dimmed" role="gridcell" aria-colindex={7}>
                  {row.errorStatus}
                </div>
                <div className="grid-cell grid-cell--numeric" role="gridcell" aria-colindex={8}>
                  {row.costPerOutput ? `$${row.costPerOutput.toFixed(4)}` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CoreGrid;
