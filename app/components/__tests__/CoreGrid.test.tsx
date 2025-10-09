import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CoreGrid, {
  DEFAULT_COLUMN_WIDTHS,
  ensureRowInitialized,
  type GridRow,
} from "../CoreGrid";

describe("CoreGrid", () => {
  const renderGrid = (
    rows: GridRow[],
    overrides: {
      onToggleRowSelection?: (rowId: string, selected: boolean) => void;
      onToggleSelectAll?: (rowIds: string[], selected: boolean) => void;
      columnWidths?: typeof DEFAULT_COLUMN_WIDTHS;
      selectedRowIds?: Set<string>;
    } = {},
  ) => {
    const onToggleRowSelection = overrides.onToggleRowSelection ?? vi.fn();
    const onToggleSelectAll = overrides.onToggleSelectAll ?? vi.fn();
    const columnWidths = overrides.columnWidths ?? { ...DEFAULT_COLUMN_WIDTHS };
    const selectedRowIds = overrides.selectedRowIds ?? new Set<string>();

    const Harness = () => {
      const [gridRows, setGridRows] = useState(rows);
      return (
        <CoreGrid
          rows={gridRows}
          setRows={setGridRows}
          displayedRowIndices={gridRows.map((_, index) => index)}
          selectedRowIds={selectedRowIds}
          onToggleRowSelection={onToggleRowSelection}
          onToggleSelectAll={onToggleSelectAll}
          columnWidths={columnWidths}
          onColumnWidthChange={vi.fn()}
        />
      );
    };

    const utils = render(<Harness />);
    return {
      ...utils,
      onToggleRowSelection,
      onToggleSelectAll,
    };
  };

  it("invokes selection callbacks for row and select-all checkboxes", async () => {
    const rows = [
      ensureRowInitialized({ rowId: "row-1", input: "alpha" }),
      ensureRowInitialized({ rowId: "row-2", input: "beta" }),
    ];

    const { onToggleRowSelection, onToggleSelectAll } = renderGrid(rows);

    await userEvent.click(screen.getByLabelText("Select row 1"));
    expect(onToggleRowSelection).toHaveBeenCalledWith(rows[0].rowId, true);

    await userEvent.click(screen.getByLabelText("Select all visible rows"));
    expect(onToggleSelectAll).toHaveBeenCalledWith(
      rows.map((row) => row.rowId),
      true,
    );
  });

  it("updates inputs, resets status, and applies derived metrics", async () => {
    const baseline = ensureRowInitialized({
      rowId: "row-1",
      status: "Complete",
      input: "Old input",
      output: "existing output",
    });
    const second = ensureRowInitialized({ rowId: "row-2", input: "" });

    renderGrid([baseline, second]);

    const firstInput = screen.getByLabelText("Input for row 1") as HTMLTextAreaElement;
    await userEvent.clear(firstInput);
    const newValue = "Fresh content with enough tokens to compute cost values in the grid";
    await userEvent.type(firstInput, newValue);

    expect(firstInput.value).toBe(newValue);

    const row = firstInput.closest(".grid-row");
    if (!row) {
      throw new Error("Row container not found");
    }
    expect(within(row).getByText("Pending")).toBeInTheDocument();

    expect(within(row).getByText(String(newValue.length))).toBeInTheDocument();
  });

  it("pastes multi-line clipboard text across sequential rows", async () => {
    const first = ensureRowInitialized({ rowId: "row-1", input: "" });
    const second = ensureRowInitialized({ rowId: "row-2", input: "" });

    renderGrid([first, second]);

    const firstInput = screen.getByLabelText("Input for row 1");

    const preventDefault = vi.fn();
    fireEvent.paste(firstInput, {
      clipboardData: {
        getData: () => "line 1\nline 2",
      },
      preventDefault,
    });

    expect(screen.getByDisplayValue("line 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("line 2")).toBeInTheDocument();
  });

  it("announces column width changes during resize interactions", async () => {
    const rows = [ensureRowInitialized({ rowId: "row-1", input: "alpha" })];
    const onColumnWidthChange = vi.fn();

    const Harness = () => {
      const [gridRows, setGridRows] = useState(rows);
      return (
        <CoreGrid
          rows={gridRows}
          setRows={setGridRows}
          displayedRowIndices={[0]}
          selectedRowIds={new Set()}
          onToggleRowSelection={vi.fn()}
          onToggleSelectAll={vi.fn()}
          columnWidths={{ ...DEFAULT_COLUMN_WIDTHS }}
          onColumnWidthChange={onColumnWidthChange}
        />
      );
    };

    const { container } = render(<Harness />);

    const resizeHandle = container.querySelector<HTMLSpanElement>(".grid-resize-handle");
    expect(resizeHandle).toBeTruthy();
    fireEvent.mouseDown(resizeHandle!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document);

    expect(onColumnWidthChange).toHaveBeenCalled();
  });
});
