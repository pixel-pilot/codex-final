"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent, CSSProperties, KeyboardEvent } from "react";

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
const GRID_TEMPLATE =
  "120px minmax(240px, 1fr) minmax(240px, 1fr) 90px 140px 160px 140px";

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
};

export function CoreGrid({ rows, setRows }: CoreGridProps) {
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = useRef(new Map<number, HTMLTextAreaElement>());

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
    (event: ClipboardEvent<HTMLTextAreaElement>, rowIndex: number) => {
      event.preventDefault();
      const clipboardText = event.clipboardData?.getData("text") ?? "";
      const values = parseClipboardText(clipboardText);
      if (!values.length) {
        return;
      }

      updateRowRange(rowIndex, values);
      setActiveRow(rowIndex);
    },
    [updateRowRange],
  );

  const handleFocus = useCallback((rowIndex: number) => {
    setActiveRow(rowIndex);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, rowIndex: number) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setRows((previous) => {
          if (rowIndex >= previous.length - 1) {
            return [...previous, createRow()];
          }

          return previous;
        });
        setActiveRow(rowIndex + 1);
      } else if (event.key === "ArrowUp") {
        if (rowIndex === 0) {
          return;
        }
        event.preventDefault();
        setActiveRow(rowIndex - 1);
      }
    },
    [setRows],
  );

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

    const input = inputRefs.current.get(activeRow);
    if (input && document.activeElement !== input) {
      requestAnimationFrame(() => {
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
      });
    }
  }, [activeRow]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setScrollTop(container.scrollTop);
    }
  }, []);

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );

    return { startIndex: start, endIndex: end };
  }, [scrollTop, viewportHeight, rows.length]);

  const visibleRows = rows.slice(startIndex, endIndex);
  const totalHeight = rows.length * ROW_HEIGHT;

  const columnHeaders = useMemo(
    () => [
      "Status",
      "Input",
      "Output",
      "Len",
      "Last Updated",
      "Error Status",
      "Cost / Output",
    ],
    [],
  );

  const gridStyle = useMemo(
    () =>
      ({
        "--grid-template-columns": GRID_TEMPLATE,
        "--grid-row-height": `${ROW_HEIGHT}px`,
      }) as CSSProperties,
    [],
  );

  return (
    <div
      className="grid-table"
      role="grid"
      aria-label="Reactive AI Spreadsheet grid"
      aria-rowcount={rows.length}
      aria-colcount={columnHeaders.length}
      style={gridStyle}
    >
      <div className="grid-header" role="row">
        {columnHeaders.map((label, index) => (
          <div
            key={label}
            className="grid-header-cell"
            role="columnheader"
            aria-colindex={index + 1}
          >
            {label}
          </div>
        ))}
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
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={1}
                >
                  {row.status}
                </div>
                <div
                  className="grid-cell grid-cell--input"
                  role="gridcell"
                  aria-colindex={2}
                >
                  <textarea
                    ref={(element) => {
                      if (element) {
                        inputRefs.current.set(rowIndex, element);
                      } else {
                        inputRefs.current.delete(rowIndex);
                      }
                    }}
                    value={row.input}
                    onChange={(event) =>
                      handleInputChange(rowIndex, event.currentTarget.value)
                    }
                    onPaste={(event) => handlePaste(event, rowIndex)}
                    onFocus={() => handleFocus(rowIndex)}
                    onKeyDown={(event) => handleKeyDown(event, rowIndex)}
                    spellCheck={false}
                    aria-label={`Input for row ${rowIndex + 1}`}
                  />
                </div>
                <div className="grid-cell" role="gridcell" aria-colindex={3}>
                  {row.output}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={4}
                >
                  {row.len ?? ""}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={5}
                >
                  {row.lastUpdated}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={6}
                >
                  {row.errorStatus}
                </div>
                <div
                  className="grid-cell grid-cell--numeric"
                  role="gridcell"
                  aria-colindex={7}
                >
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
