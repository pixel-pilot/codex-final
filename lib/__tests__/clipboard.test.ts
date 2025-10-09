/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { extractClipboardValues } from "../clipboard";

type ClipboardStub = Pick<DataTransfer, "getData">;

const createClipboard = (data: Record<string, string>): DataTransfer => {
  const stub: ClipboardStub = {
    getData: (type: string) => data[type] ?? "",
  };

  return stub as DataTransfer;
};

describe("extractClipboardValues", () => {
  it("returns multi-line cell content from HTML tables as a single row", () => {
    const clipboard = createClipboard({
      "text/html":
        "<table><tbody><tr><td><div>Line 1</div><div>Line 2</div></td></tr></tbody></table>",
    });

    expect(extractClipboardValues(clipboard)).toEqual(["Line 1\nLine 2"]);
  });

  it("extracts successive rows from HTML tables", () => {
    const clipboard = createClipboard({
      "text/html":
        "<table><tr><td>Row 1</td></tr><tr><td>Row 2</td></tr><tr><td></td></tr></table>",
    });

    expect(extractClipboardValues(clipboard)).toEqual(["Row 1", "Row 2"]);
  });

  it("falls back to plain text parsing when HTML is unavailable", () => {
    const clipboard = createClipboard({
      "text/plain": "Row 1\r\nRow 2\r\n",
    });

    expect(extractClipboardValues(clipboard)).toEqual(["Row 1", "Row 2"]);
  });

  it("preserves lone newlines within a single row on plain text pastes", () => {
    const clipboard = createClipboard({
      "text/plain": "First line\nSecond line",
    });

    expect(extractClipboardValues(clipboard)).toEqual(["First line\nSecond line"]);
  });
});
