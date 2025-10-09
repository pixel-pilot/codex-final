import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

beforeAll(() => {
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    if (typeof window.HTMLElement !== "undefined") {
      Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
        value: () => {},
        writable: true,
      });
    }
  }
});

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
