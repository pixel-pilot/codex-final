"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
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
};

export type CoreGridHandle = {
  copyInputs: () => Promise<void>;
  copyOutputs: () => Promise<void>;
};

const INITIAL_ROW_COUNT = 5000;
const ROW_HEIGHT = 40;
const OVERSCAN = 8;
const COLUMN_STORAGE_KEY = "reactive-ai-spreadsheet-column-widths";

const COLUMN_DEFINITIONS = [
  {
    key: "rowNumber" as const,
    label: "#",
    letter: "",
    minWidth: 56,
    defaultWidth: 64,
    flexible: false,
  },
  {
    key: "status" as const,
    label: "Status",
    letter: "A",
    minWidth: 112,
    defaultWidth: 128,
    flexible: false,
  },
  {
    key: "input" as const,
    label: "Input",
    letter: "B",
    minWidth: 260,
    defaultWidth: 320,
    flexible: true,
  },
  {
    key: "output" as const,
    label: "Output",
    letter: "C",
    minWidth: 260,
    defaultWidth: 320,
    flexible: true,
  },
  {
    key: "len" as const,
    label: "Len",
    letter: "D",
    minWidth: 72,
    defaultWidth: 90,
    flexible: false,
  },
  {
    key: "lastUpdated" as const,
    label: "Last Updated",
    letter: "E",
    minWidth: 180,
    defaultWidth: 200,
    flexible: false,
  },
  {
    key: "errorStatus" as const,
    label: "Error Status",
    letter: "F",
    minWidth: 160,
    defaultWidth: 180,
    flexible: false,
  },
];

const generateRowId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const createTimestamp = () => new Date().toISOString();

const ensureRowInitialized = (row?: GridRow): GridRow => {
  const input = row?.input ?? "";

  return {
    rowId: row?.rowId?.trim() ? row.rowId : generateRowId(),
    retries: typeof row?.retries === "number" ? row.retries : 0,
    status: row?.status?.trim() ? row.status : "Pending",
    input,
    output: row?.output ?? "",
    len: typeof row?.len === "number" ? row.len : input ? input.length : null,
    lastUpdated: row?.lastUpdated ?? "",
    errorStatus: row?.errorStatus ?? "",
  };
};

const createRow = (): GridRow => ensureRowInitialized();

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

const loadStoredWidths = (): number[] => {
  const defaults = COLUMN_DEFINITIONS.map((column) => column.defaultWidth);
  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!stored) {
      return defaults;
    }

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return defaults;
    }

    return COLUMN_DEFINITIONS.map((column, index) => {
      const candidate = Number(parsed[index]);
      if (Number.isFinite(candidate) && candidate >= column.minWidth) {
        return candidate;
      }
      return column.defaultWidth;
    });
  } catch (error) {
    console.warn("Failed to parse stored column widths", error);
    return defaults;
  }
};

const COLUMN_COUNT = COLUMN_DEFINITIONS.length;
const MIN_ROW_INDEX = 0;

const CoreGrid = forwardRef<CoreGridHandle>(function CoreGridComponent(_, ref) {
  const [rows, setRows] = useState<GridRow[]>(() =>
    Array.from({ length: INITIAL_ROW_COUNT }, () => createRow()),
  );
  const [activeRow, setActiveRow] = useState(0);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [columnWidths, setColumnWidths] = useState<number[]>(() => loadStoredWidths());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const resizeStateRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const rowsRef = useRef<GridRow[]>(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      COLUMN_STORAGE_KEY,
      JSON.stringify(columnWidths),
    );
  }, [columnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== COLUMN_STORAGE_KEY || !event.newValue) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        if (!Array.isArray(parsed)) {
          return;
        }

        setColumnWidths((previous) => {
          const next = COLUMN_DEFINITIONS.map((column, index) => {
            const candidate = Number(parsed[index]);
            if (Number.isFinite(candidate) && candidate >= column.minWidth) {
              return candidate;
            }
            return column.defaultWidth;
          });

          if (
            next.length === previous.length &&
            next.every((value, index) => value === previous[index])
          ) {
            return previous;
          }

          return next;
        });
      } catch (error) {
        console.warn("Failed to hydrate column widths from storage event", error);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const focusClipboardInput = useCallback(() => {
    if (editingRow !== null) {
      return;
    }

    const clipboard = clipboardRef.current;
    if (!clipboard) {
      return;
    }

    clipboard.focus();
    const length = clipboard.value.length;
    clipboard.setSelectionRange(length, length);
  }, [editingRow]);

  const copyTextToClipboard = useCallback(
    async (text: string) => {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch (error) {
          console.warn("navigator.clipboard.writeText failed, falling back", error);
        }
      }

      const clipboard = clipboardRef.current;
      if (!clipboard) {
        return;
      }

      const previousValue = clipboard.value;
      clipboard.value = text;
      clipboard.focus();
      clipboard.select();
      try {
        document.execCommand("copy");
      } catch (error) {
        console.error("Fallback clipboard copy failed", error);
      } finally {
        clipboard.value = "";
        focusClipboardInput();
        clipboard.setSelectionRange(clipboard.value.length, clipboard.value.length);
        if (previousValue) {
          clipboard.value = previousValue;
        }
      }
    },
    [focusClipboardInput],
  );

  const copyColumnValues = useCallback(
    async (key: "input" | "output") => {
      const snapshot = rowsRef.current;
      if (!snapshot.length) {
        await copyTextToClipboard("");
        return;
      }

      const text = snapshot.map((row) => row[key] ?? "").join("\n");
      await copyTextToClipboard(text);
    },
    [copyTextToClipboard],
  );

  useImperativeHandle(
    ref,
    () => ({
      copyInputs: () => copyColumnValues("input"),
      copyOutputs: () => copyColumnValues("output"),
    }),
    [copyColumnValues],
  );

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
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
  }, [activeRow]);

  useEffect(() => {
    if (editingRow === null) {
      focusClipboardInput();
    }
  }, [activeRow, editingRow, focusClipboardInput]);

  useEffect(() => {
    if (editingRow === null) {
      return;
    }

    const input = inputRefs.current.get(editingRow);
    if (input && document.activeElement !== input) {
      requestAnimationFrame(() => {
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
      });
    }
  }, [editingRow]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setScrollTop(container.scrollTop);
    }
  }, []);

  useEffect(() => {
    if (!rows.length) {
      return;
    }

    if (activeRow > rows.length - 1) {
      setActiveRow(rows.length - 1);
    }
  }, [activeRow, rows.length]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setScrollTop(container.scrollTop);
  }, []);

  const templateColumns = useMemo(() => {
    return columnWidths
      .map((width, index) => {
        const column = COLUMN_DEFINITIONS[index];
        const constrained = Math.max(column.minWidth, width);
        if (column.flexible) {
          return `minmax(${constrained}px, 1fr)`;
        }
        return `${constrained}px`;
      })
      .join(" ");
  }, [columnWidths]);

  const gridStyle = useMemo(
    () =>
      ({
        "--grid-template-columns": templateColumns,
        "--grid-row-height": `${ROW_HEIGHT}px`,
      }) as CSSProperties,
    [templateColumns],
  );

  const updateRowRange = useCallback((startIndex: number, values: string[]) => {
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
        const updated: GridRow = {
          ...normalized,
          input: nextInput,
          status: shouldResetStatus ? "Pending" : normalized.status,
          len: nextLen,
          lastUpdated: nextTimestamp,
        };

        if (
          shouldResetStatus ||
          normalized.len !== updated.len ||
          normalized.lastUpdated !== updated.lastUpdated
        ) {
          mutated = true;
        }

        next[targetIndex] = updated;
      });

      return mutated ? next : previous;
    });
  }, []);

  const handleInputChange = useCallback((rowIndex: number, value: string) => {
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
      const updated: GridRow = {
        ...normalized,
        input: nextInput,
        status: shouldResetStatus ? "Pending" : normalized.status,
        len: nextLen,
        lastUpdated: nextTimestamp,
      };

      const createdRow = rowIndex >= previous.length;

      if (
        !shouldResetStatus &&
        normalized.input === updated.input &&
        normalized.len === updated.len &&
        normalized.lastUpdated === updated.lastUpdated &&
        !createdRow
      ) {
        return previous;
      }

      next[rowIndex] = updated;
      return next;
    });

    setActiveRow(rowIndex);
  }, []);

  const applyClipboardText = useCallback(
    (rowIndex: number, clipboardText: string): boolean => {
      const values = parseClipboardText(clipboardText);
      if (!values.length) {
        return false;
      }

      updateRowRange(rowIndex, values);
      setActiveRow(rowIndex);
      if (values.length > 1) {
        setEditingRow(null);
      }

      return true;
    },
    [updateRowRange],
  );

  const handlePasteAtRow = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>, rowIndex: number) => {
      event.preventDefault();
      const clipboardText = event.clipboardData?.getData("text") ?? "";
      const applied = applyClipboardText(rowIndex, clipboardText);
      if (!applied) {
        return;
      }

      const clipboard = clipboardRef.current;
      if (clipboard) {
        clipboard.value = "";
      }
    },
    [applyClipboardText],
  );

  const handleClipboardPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      handlePasteAtRow(event, activeRow);
    },
    [activeRow, handlePasteAtRow],
  );

  const pasteFromClipboardAPI = useCallback(
    async (rowIndex: number) => {
      if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          return;
        }

        const applied = applyClipboardText(rowIndex, text);
        if (applied) {
          const clipboard = clipboardRef.current;
          if (clipboard) {
            clipboard.value = "";
          }
        }
      } catch (error) {
        console.warn("Failed to read clipboard text via navigator.clipboard", error);
      }
    },
    [applyClipboardText],
  );

  const handleRowMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>, rowIndex: number) => {
      if ((event.target as HTMLElement).closest(".grid-resize-handle")) {
        return;
      }

      event.preventDefault();
      setActiveRow(rowIndex);
      setEditingRow(null);

      requestAnimationFrame(() => {
        focusClipboardInput();
      });
    },
    [focusClipboardInput],
  );

  const startEditingRow = useCallback((rowIndex: number) => {
    setActiveRow(rowIndex);
    setEditingRow(rowIndex);
  }, []);

  const handleEditingBlur = useCallback((rowIndex: number) => {
    setEditingRow((current) => (current === rowIndex ? null : current));
    setActiveRow(rowIndex);
  }, []);

  const handleClipboardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        if (event.shiftKey) {
          void pasteFromClipboardAPI(activeRow);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        let appended = false;
        setRows((previous) => {
          if (activeRow >= previous.length - 1) {
            appended = true;
            return [...previous, createRow()];
          }
          return previous;
        });

        setActiveRow((current) => {
          const base = current ?? MIN_ROW_INDEX;
          const length = rowsRef.current.length + (appended ? 1 : 0);
          const nextIndex = Math.min(base + 1, Math.max(MIN_ROW_INDEX, length - 1));
          return nextIndex;
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveRow((current) => {
          const base = current ?? MIN_ROW_INDEX;
          return Math.max(MIN_ROW_INDEX, base - 1);
        });
      } else if (event.key === "Enter") {
        event.preventDefault();
        setEditingRow(activeRow);
      }
    },
    [activeRow],
  );

  const handleEditingKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, rowIndex: number) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && event.shiftKey) {
        void pasteFromClipboardAPI(rowIndex);
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        let appended = false;
        setRows((previous) => {
          if (rowIndex >= previous.length - 1) {
            appended = true;
            return [...previous, createRow()];
          }
          return previous;
        });

        setEditingRow(null);
        setActiveRow(() => {
          const length = rowsRef.current.length + (appended ? 1 : 0);
          const nextIndex = Math.min(rowIndex + 1, Math.max(MIN_ROW_INDEX, length - 1));
          return nextIndex;
        });
      } else if (event.key === "Escape") {
        event.preventDefault();
        setEditingRow(null);
        setActiveRow(rowIndex);
        focusClipboardInput();
      }
    },
    [focusClipboardInput, pasteFromClipboardAPI],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      const column = COLUMN_DEFINITIONS[state.index];
      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(column.minWidth, state.startWidth + delta);

      setColumnWidths((previous) => {
        if (previous[state.index] === nextWidth) {
          return previous;
        }

        const next = [...previous];
        next[state.index] = nextWidth;
        return next;
      });
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const handleResizePointerDown = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        index,
        startX: event.clientX,
        startWidth: columnWidths[index],
      };
    },
    [columnWidths],
  );

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

  return (
    <div
      className="grid-table"
      role="grid"
      aria-label="Reactive AI Spreadsheet grid"
      aria-rowcount={rows.length}
      aria-colcount={COLUMN_COUNT}
      style={gridStyle}
    >
      <textarea
        ref={clipboardRef}
        className="grid-clipboard-input"
        aria-hidden="true"
        tabIndex={-1}
        spellCheck={false}
        onPaste={handleClipboardPaste}
        onKeyDown={handleClipboardKeyDown}
      />
      <div className="grid-header" role="presentation">
        <div className="grid-header-row grid-header-row--letters" role="row">
          {COLUMN_DEFINITIONS.map((column, index) => (
            <div
              key={`${column.key}-letter`}
              className="grid-header-cell grid-header-cell--letter"
              role="columnheader"
              aria-colindex={index + 1}
            >
              {column.letter}
            </div>
          ))}
        </div>
        <div className="grid-header-row grid-header-row--labels" role="row">
          {COLUMN_DEFINITIONS.map((column, index) => (
            <div
              key={column.key}
              className="grid-header-cell grid-header-cell--label"
              role="columnheader"
              aria-colindex={index + 1}
            >
              <span>{column.label}</span>
              <div
                className="grid-resize-handle"
                aria-hidden="true"
                onPointerDown={(event) => handleResizePointerDown(index, event)}
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
            const toneClass = rowIndex % 2 === 0 ? "grid-row--even" : "grid-row--odd";
            const rowClasses = ["grid-row", toneClass];
            if (isActive) {
              rowClasses.push("grid-row--active");
            }

            const baseStyle = { transform: `translateY(${rowIndex * ROW_HEIGHT}px)` };

            return (
              <div
                key={row.rowId ?? rowIndex}
                className={rowClasses.join(" ")}
                role="row"
                aria-rowindex={rowIndex + 1}
                style={baseStyle}
                onMouseDown={(event) => handleRowMouseDown(event, rowIndex)}
              >
                <div
                  className="grid-cell grid-cell--row-number read-only-dimmed"
                  role="gridcell"
                  aria-colindex={1}
                >
                  {rowIndex + 1}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={2}
                >
                  {row.status}
                </div>
                <div
                  className="grid-cell grid-cell--input"
                  role="gridcell"
                  aria-colindex={3}
                  aria-selected={isActive && editingRow === null ? true : undefined}
                  onDoubleClick={() => startEditingRow(rowIndex)}
                >
                  {editingRow === rowIndex ? (
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
                      onPaste={(event) => handlePasteAtRow(event, rowIndex)}
                      onBlur={() => handleEditingBlur(rowIndex)}
                      onKeyDown={(event) => handleEditingKeyDown(event, rowIndex)}
                      spellCheck={false}
                      aria-label={`Input for row ${rowIndex + 1}`}
                      autoFocus
                    />
                  ) : (
                    <span className="grid-cell-text">{row.input}</span>
                  )}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={4}
                >
                  {row.output}
                </div>
                <div
                  className="grid-cell grid-cell--len read-only-dimmed"
                  role="gridcell"
                  aria-colindex={5}
                >
                  {row.len ?? ""}
                </div>
                <div
                  className="grid-cell grid-cell--timestamp read-only-dimmed"
                  role="gridcell"
                  aria-colindex={6}
                >
                  {row.lastUpdated}
                </div>
                <div
                  className="grid-cell read-only-dimmed"
                  role="gridcell"
                  aria-colindex={7}
                >
                  {row.errorStatus}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default CoreGrid;
