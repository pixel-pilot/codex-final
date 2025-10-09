import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

const ROW_STORAGE_KEY = "reactive-ai-spreadsheet-rows";
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
    window.localStorage.clear();
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
  });

  it("hydrates saved rows, updates metrics, and persists changes", async () => {
    const init = await ensureRowInitialized();
    const savedRows = [
      init({ rowId: "row-pending", status: "Pending", input: "pending text" }),
      init({ rowId: "row-progress", status: "In Progress", input: "progress input" }),
      init({ rowId: "row-complete", status: "Complete", input: "complete", output: "done" }),
    ];

    window.localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(savedRows));

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

    await waitFor(() => {
      const stored = window.localStorage.getItem(ROW_STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = stored ? JSON.parse(stored) : [];
      expect(parsed).toEqual(expect.arrayContaining([expect.objectContaining({ rowId: "row-complete" })]));
    });
  });

  it("responds to cross-tab storage events by replacing rows", async () => {
    const init = await ensureRowInitialized();
    const HomeContent = await loadHomeContent();

    render(<HomeContent />);
    await screen.findByRole("button", { name: /generation/i });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ROW_STORAGE_KEY,
          newValue: JSON.stringify([
            init({ rowId: "remote", status: "Pending", input: "remote" }),
            init({ rowId: "remote-2", status: "Complete", input: "remote", output: "ok" }),
          ]),
        }),
      );
    });

    await screen.findByText(/rows match/);
    expect(getMetricValue("Completed")).toHaveTextContent("1");
  });

  it("supports selection flows via grid callbacks", async () => {
    const init = await ensureRowInitialized();
    window.localStorage.setItem(
      ROW_STORAGE_KEY,
      JSON.stringify([
        init({ rowId: "a", status: "Pending", input: "alpha" }),
        init({ rowId: "b", status: "Pending", input: "beta" }),
      ]),
    );

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);
    await screen.findByTestId("core-grid-mock");

    const resetButton = screen.getByRole("button", { name: /reset selection/i });
    expect(resetButton).toBeDisabled();

    await userEvent.click(screen.getByTestId("select-first"));
    expect(resetButton).toBeEnabled();

    await userEvent.click(resetButton);
    expect(resetButton).toBeDisabled();

    await userEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByText(/selected/)).toHaveTextContent("2");
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

    const init = await ensureRowInitialized();
    window.localStorage.setItem(
      ROW_STORAGE_KEY,
      JSON.stringify([
        init({ rowId: "pending-1", status: "Pending", input: "process me" }),
      ]),
    );

    const HomeContent = await loadHomeContent();
    render(<HomeContent />);

    const toggle = await screen.findByRole("button", { name: /generation/i });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    expect(intervalCallbacks).not.toHaveLength(0);

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(getMetricValue("In progress")).toHaveTextContent("1");
    });

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => {
      expect(getMetricValue("Completed")).toHaveTextContent("1");
    });
  });
});
