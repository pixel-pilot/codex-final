import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { useUpdatesStore } from "../../stores/updatesStore";

const writeTextToClipboardMock = vi.fn(async (_text: string) => true);

vi.mock("../../../lib/clipboard", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/clipboard")>(
    "../../../lib/clipboard",
  );

  return {
    ...actual,
    writeTextToClipboard: writeTextToClipboardMock,
  };
});

vi.mock("../CoreGrid", async () => {
  const actual = await vi.importActual<typeof import("../CoreGrid")>("../CoreGrid");

  type GridRow = ReturnType<typeof actual.ensureRowInitialized>;

  const MockCoreGrid = ({
    rows,
    displayedRowIndices,
    onToggleRowSelection,
    onToggleSelectAll,
  }: {
    rows: GridRow[];
    displayedRowIndices: number[];
    onToggleRowSelection: (rowId: string, selected: boolean) => void;
    onToggleSelectAll: (rowIds: string[], selected: boolean) => void;
  }) => {
    const selectableIds = displayedRowIndices.map((index) => rows[index]?.rowId).filter(Boolean);

    return (
      <div data-testid="core-grid-mock">
        <span data-testid="visible-count">{displayedRowIndices.length}</span>
        <button
          type="button"
          data-testid="select-first"
          disabled={!selectableIds.length}
          onClick={() => selectableIds[0] && onToggleRowSelection(selectableIds[0], true)}
        >
          select-first
        </button>
        <button
          type="button"
          data-testid="select-all"
          disabled={!selectableIds.length}
          onClick={() => selectableIds.length && onToggleSelectAll(selectableIds, true)}
        >
          select-all
        </button>
      </div>
    );
  };

  return {
    ...actual,
    INITIAL_ROW_COUNT: 12,
    createInitialRows: (count: number) => actual.createInitialRows(Math.min(count, 12)),
    default: MockCoreGrid,
  };
});

type GridRepositoryModule = typeof import("../../../lib/gridRepository");
type SystemRepositoryModule = typeof import("../../../lib/systemRepository");
type UsageLogRepositoryModule = typeof import("../../../lib/usageLogRepository");

const createGridRepositoryMock = () => {
  let rows: Array<any> = [];
  let columnWidths: Record<string, number> = {};
  let errorLog: Array<any> = [];
  const rowListeners = new Set<(next: any[]) => void>();
  const loadGridRows = vi.fn(async () => rows);
  const saveGridRows = vi.fn(async (next: any[]) => {
    rows = next;
    rowListeners.forEach((listener) => listener(next));
  });
  const subscribeToGridRows = vi.fn((handler: (next: any[]) => void) => {
    rowListeners.add(handler);
    return () => {
      rowListeners.delete(handler);
    };
  });
  const loadColumnWidths = vi.fn(async () => columnWidths);
  const saveColumnWidths = vi.fn(async (next: Record<string, number>) => {
    columnWidths = next;
  });
  const loadErrorLog = vi.fn(async () => errorLog);
  const saveErrorLog = vi.fn(async (next: any[]) => {
    errorLog = next;
  });

  return {
    loadGridRows,
    saveGridRows,
    subscribeToGridRows,
    loadColumnWidths,
    saveColumnWidths,
    subscribeToColumnWidths: vi.fn(() => () => {}),
    loadErrorLog,
    saveErrorLog,
    subscribeToErrorLog: vi.fn(() => () => {}),
    __setRows(next: any[]) {
      rows = next;
    },
    __emitRows(next: any[]) {
      rows = next;
      rowListeners.forEach((listener) => listener(next));
    },
    __reset() {
      rows = [];
      columnWidths = {};
      errorLog = [];
      rowListeners.clear();
      loadGridRows.mockReset();
      saveGridRows.mockReset();
      subscribeToGridRows.mockReset();
      loadColumnWidths.mockReset();
      saveColumnWidths.mockReset();
      loadErrorLog.mockReset();
      saveErrorLog.mockReset();
    },
  } satisfies Partial<GridRepositoryModule> & {
    __setRows: (next: any[]) => void;
    __emitRows: (next: any[]) => void;
    __reset: () => void;
  };
};

const gridRepositoryMock = createGridRepositoryMock();

vi.mock("../../../lib/gridRepository", () => gridRepositoryMock);

const createSystemRepositoryMock = () => {
  let state: any = null;
  const listeners = new Set<(payload: any) => void>();
  const loadSystemState = vi.fn<ReturnType<SystemRepositoryModule["loadSystemState"]>, Parameters<SystemRepositoryModule["loadSystemState"]>>();
  const saveSystemState = vi.fn<ReturnType<SystemRepositoryModule["saveSystemState"]>, Parameters<SystemRepositoryModule["saveSystemState"]>>();
  const subscribeToSystemState = vi.fn<
    ReturnType<SystemRepositoryModule["subscribeToSystemState"]>,
    Parameters<SystemRepositoryModule["subscribeToSystemState"]>
  >();

  const applyDefaultImplementation = () => {
    loadSystemState.mockImplementation(async () => state);
    saveSystemState.mockImplementation(async (payload: any) => {
      state = payload;
      listeners.forEach((listener) => listener(payload));
    });
    subscribeToSystemState.mockImplementation((handler: (payload: any) => void) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    });
  };

  applyDefaultImplementation();

  return {
    loadSystemState,
    saveSystemState,
    subscribeToSystemState,
    __setState(next: any) {
      state = next;
    },
    __reset() {
      state = null;
      listeners.clear();
      loadSystemState.mockReset();
      saveSystemState.mockReset();
      subscribeToSystemState.mockReset();
      applyDefaultImplementation();
    },
  } satisfies Partial<SystemRepositoryModule> & {
    __setState: (next: any) => void;
    __reset: () => void;
  };
};

const systemRepositoryMock = createSystemRepositoryMock();

vi.mock("../../../lib/systemRepository", () => systemRepositoryMock);

const createUsageLogRepositoryMock = () => {
  let entries: Array<any> = [];
  const listeners = new Set<(next: any[]) => void>();

  const loadUsageLog = vi.fn<
    ReturnType<UsageLogRepositoryModule["loadUsageLog"]>,
    Parameters<UsageLogRepositoryModule["loadUsageLog"]>
  >();
  const saveUsageLog = vi.fn<
    ReturnType<UsageLogRepositoryModule["saveUsageLog"]>,
    Parameters<UsageLogRepositoryModule["saveUsageLog"]>
  >();
  const subscribeToUsageLog = vi.fn<
    ReturnType<UsageLogRepositoryModule["subscribeToUsageLog"]>,
    Parameters<UsageLogRepositoryModule["subscribeToUsageLog"]>
  >();

  const applyDefaultImplementation = () => {
    loadUsageLog.mockImplementation(async () => entries);
    saveUsageLog.mockImplementation(async (payload: any[]) => {
      entries = payload;
      listeners.forEach((listener) => listener(payload));
    });
    subscribeToUsageLog.mockImplementation((handler: (payload: any[]) => void) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    });
  };

  applyDefaultImplementation();

  return {
    loadUsageLog,
    saveUsageLog,
    subscribeToUsageLog,
    __set(next: any[]) {
      entries = next;
    },
    __emit(next: any[]) {
      entries = next;
      listeners.forEach((listener) => listener(next));
    },
    __reset() {
      entries = [];
      listeners.clear();
      loadUsageLog.mockReset();
      saveUsageLog.mockReset();
      subscribeToUsageLog.mockReset();
      applyDefaultImplementation();
    },
  } satisfies Partial<UsageLogRepositoryModule> & {
    __set: (next: any[]) => void;
    __emit: (next: any[]) => void;
    __reset: () => void;
  };
};

const usageLogRepositoryMock = createUsageLogRepositoryMock();

vi.mock("../../../lib/usageLogRepository", () => usageLogRepositoryMock);

vi.mock("../UpdatesPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="updates-panel-mock" />,
}));

let settingsState: any = null;
const settingsListeners = new Set<(payload: any) => void>();

vi.mock("../../../lib/settingsRepository", () => ({
  loadSettingsState: vi.fn(async () => settingsState),
  saveSettingsState: vi.fn(async (payload: any) => {
    settingsState = payload;
    settingsListeners.forEach((listener) => listener(payload));
  }),
  subscribeToSettingsState: vi.fn((handler: (payload: any) => void) => {
    settingsListeners.add(handler);
    return () => {
      settingsListeners.delete(handler);
    };
  }),
  loadModelCatalog: vi.fn(async () => null),
  saveModelCatalog: vi.fn(async () => undefined),
  subscribeToModelCatalog: vi.fn(() => () => {}),
}));

const loadHomeContent = async () => {
  const module = await import("../HomeContent");
  return module.default;
};

const ensureRowInitialized = async () => {
  const module = await import("../CoreGrid");
  return module.ensureRowInitialized;
};

const getMetricValue = (label: string) => {
  const metricLabel = screen.getByText(label);
  const container = metricLabel.closest(".generate-metric");
  if (!container) {
    throw new Error(`Unable to locate metric container for ${label}`);
  }
  return within(container).getByText((content, element) => {
    return element?.classList.contains("generate-metric__value") ?? false;
  });
};

describe("HomeContent", () => {
  beforeEach(() => {
    gridRepositoryMock.__reset();
    systemRepositoryMock.__reset();
    usageLogRepositoryMock.__reset();
    settingsState = null;
    settingsListeners.clear();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          coverage: {
            statements: 98,
            branches: 94,
            functions: 96,
            lines: 97,
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    writeTextToClipboardMock.mockClear();
  });

  it("hydrates saved rows, updates metrics, and persists changes", async () => {
    const init = await ensureRowInitialized();
    const savedRows = [
      init({ rowId: "row-pending", status: "Pending", input: "pending text" }),
      init({ rowId: "row-progress", status: "In Progress", input: "progress input" }),
      init({ rowId: "row-complete", status: "Complete", input: "complete", output: "done" }),
    ];

    gridRepositoryMock.__setRows(savedRows);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    await screen.findByRole("button", { name: /generation/i });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/qa/latest.json",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    const pendingValue = getMetricValue("Pending rows");
    expect(pendingValue).toHaveTextContent("1");
    const inProgressValue = getMetricValue("In progress");
    expect(inProgressValue).toHaveTextContent("1");
    const completeValue = getMetricValue("Completed");
    expect(completeValue).toHaveTextContent("1");

    const filterInput = screen.getByPlaceholderText("Search input text");
    await userEvent.type(filterInput, "complete");
    expect(screen.getByText(/rows match/)).toHaveTextContent("1 rows match");

    await userEvent.clear(filterInput);
    expect(screen.getByText(/rows match/)).toHaveTextContent("3 rows match");

    expect(gridRepositoryMock.loadGridRows).toHaveBeenCalled();
    expect(usageLogRepositoryMock.loadUsageLog).toHaveBeenCalled();
    expect(usageLogRepositoryMock.subscribeToUsageLog).toHaveBeenCalled();
  });

  it("responds to cross-tab storage events by replacing rows", async () => {
    const init = await ensureRowInitialized();
    const HomeContent = await loadHomeContent();

    render(<HomeContent />);
    await screen.findByRole("button", { name: /generation/i });

    act(() => {
      gridRepositoryMock.__emitRows([
        init({ rowId: "remote", status: "Pending", input: "remote" }),
        init({ rowId: "remote-2", status: "Complete", input: "remote", output: "ok" }),
      ]);
    });

    await screen.findByText(/rows match/);
    expect(getMetricValue("Completed")).toHaveTextContent("1");
  });

  it("supports selection flows via grid callbacks", async () => {
    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "a", status: "Pending", input: "alpha" }),
      init({ rowId: "b", status: "Pending", input: "beta" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);
    await screen.findByTestId("core-grid-mock");

    const resetButton = screen.getByRole("button", { name: /deselect all/i });
    expect(resetButton).toBeDisabled();

    await userEvent.click(screen.getByTestId("select-first"));
    expect(resetButton).toBeEnabled();

    await userEvent.click(resetButton);
    expect(resetButton).toBeDisabled();

    await userEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByText(/selected/)).toHaveTextContent("2");
  });

  it("copies selected inputs and outputs via action shortcuts", async () => {
    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "row-1", status: "Pending", input: "alpha", output: "" }),
      init({ rowId: "row-2", status: "Complete", input: "beta", output: "gamma" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    await screen.findByTestId("core-grid-mock");

    const selectAll = screen.getByTestId("select-all");
    await userEvent.click(selectAll);

    const copyInputsButton = screen.getByRole("button", { name: /copy all inputs/i });
    await userEvent.click(copyInputsButton);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith("alpha\nbeta");

    writeTextToClipboardMock.mockClear();
    const copyOutputsButton = screen.getByRole("button", { name: /copy all outputs/i });
    await userEvent.click(copyOutputsButton);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith("\ngamma");
  });

  it("advances generation state when the system toggle is enabled", async () => {
    const intervalCallbacks: Array<() => void> = [];
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    vi.spyOn(window, "setInterval").mockImplementation((callback: TimerHandler) => {
      const fn = callback as () => void;
      intervalCallbacks.push(fn);
      return 1 as unknown as number;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});

    settingsState = {
      apiKey: "",
      selectedModelId: "anthropic/claude-3-opus",
      webSearchEnabled: true,
      maxTokens: 2048,
      temperature: 0.6,
      repetitionPenalty: 1.1,
      topP: 0.95,
      topK: 30,
      reasoningLevel: "deep",
      rateLimitPerMinute: 180,
      knownModelIds: [],
      modelNotifications: [],
    };

    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "pending-1", status: "Pending", input: "process me" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    const toggle = await screen.findByRole("button", { name: /generation/i });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(systemRepositoryMock.saveSystemState).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
      );
    });

    expect(intervalCallbacks).not.toHaveLength(0);

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(gridRepositoryMock.saveGridRows).toHaveBeenCalled();
    });

    const lastPersisted =
      gridRepositoryMock.saveGridRows.mock.calls[
      gridRepositoryMock.saveGridRows.mock.calls.length - 1
    ][0];
    expect(lastPersisted).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "Complete" })]),
    );

    await waitFor(() => {
      expect(usageLogRepositoryMock.saveUsageLog).toHaveBeenCalled();
    });

    const usagePersisted =
      usageLogRepositoryMock.saveUsageLog.mock.calls[
        usageLogRepositoryMock.saveUsageLog.mock.calls.length - 1
      ][0];

    expect(Array.isArray(usagePersisted)).toBe(true);
    expect(usagePersisted.length).toBeGreaterThan(0);
    expect(usagePersisted[0]).toEqual(
      expect.objectContaining({
        rowId: "pending-1",
        status: "Complete",
        model: "anthropic/claude-3-opus",
        modelId: "anthropic/claude-3-opus",
        webSearchEnabled: true,
        rateLimitPerMinute: 180,
        inputPreview: expect.any(String),
        outputPreview: expect.any(String),
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
        cost: expect.any(Number),
        promptCost: expect.any(Number),
        completionCost: expect.any(Number),
        inputCharacters: expect.any(Number),
        outputCharacters: expect.any(Number),
        len: expect.any(Number),
        timestamp: expect.any(String),
        lastUpdated: expect.any(String),
        maxTokens: 2048,
        temperature: 0.6,
        topP: 0.95,
        topK: 30,
        repetitionPenalty: 1.1,
        reasoningLevel: "deep",
      }),
    );
  });

  it("auto-disables generation when no actionable inputs exist", async () => {
    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "done", status: "Complete", input: "finished", output: "ok" }),
      init({ rowId: "blank", status: "Pending", input: "" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    const toggle = await screen.findByRole("button", { name: /generation/i });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("turns off generation when only exhausted error rows remain", async () => {
    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "err", status: "Error", retries: 3, input: "still broken" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    const toggle = await screen.findByRole("button", { name: /generation/i });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("turns off generation after the final pending row completes", async () => {
    const intervalCallbacks: Array<() => void> = [];
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    vi.spyOn(window, "setInterval").mockImplementation((callback: TimerHandler) => {
      const fn = callback as () => void;
      intervalCallbacks.push(fn);
      return 1 as unknown as number;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});

    const init = await ensureRowInitialized();
    gridRepositoryMock.__setRows([
      init({ rowId: "pending-final", status: "Pending", input: "process me" }),
    ]);

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    const toggle = await screen.findByRole("button", { name: /generation/i });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(gridRepositoryMock.saveGridRows).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });
  });
});
