import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabaseClient", () => ({
  getSupabaseClient: vi.fn(),
}));

import { bundledUpdates } from "../../lib/staticUpdates";
import { listUpdates } from "../../lib/updatesRepository";
import { getSupabaseClient } from "../../lib/supabaseClient";

type SupabaseResponse = {
  data: Array<{
    id: string;
    timestamp: string;
    title: string;
    description: string;
    category: string;
    version: string | null;
    author: string | null;
  }> | null;
  error: Error | null;
};

const createQueryBuilder = (response: SupabaseResponse) => {
  const promise = Promise.resolve(response);
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    textSearch: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    or: vi.fn(() => builder),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  return builder;
};

const createSupabaseClientMock = (response: SupabaseResponse) => ({
  from: vi.fn(() => createQueryBuilder(response)),
});

const supabaseClientMock = vi.mocked(getSupabaseClient);

describe("listUpdates fallback", () => {
  beforeEach(() => {
    supabaseClientMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns bundled updates sorted newest first when Supabase is unavailable", async () => {
    supabaseClientMock.mockImplementation(() => {
      throw new Error("Supabase unavailable");
    });

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { entries, nextCursor } = await listUpdates({ limit: 2 });

    expect(infoSpy).toHaveBeenCalled();
    expect(entries).toHaveLength(2);
    expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(entries[1].timestamp).getTime(),
    );
    expect(nextCursor).not.toBeNull();
  });

  it("paginates bundled updates using the serialized cursor", async () => {
    supabaseClientMock.mockImplementation(() => {
      throw new Error("Supabase unavailable");
    });

    const firstPage = await listUpdates({ limit: 2 });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listUpdates({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.entries.length).toBe(bundledUpdates.length - firstPage.entries.length);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("applies category and search filters to bundled updates", async () => {
    supabaseClientMock.mockImplementation(() => {
      throw new Error("Supabase unavailable");
    });

    const { entries: uiEntries } = await listUpdates({ category: "UI" });
    expect(uiEntries.every((entry) => entry.category === "UI")).toBe(true);

    const { entries: searchEntries } = await listUpdates({ search: "resilience" });
    expect(searchEntries).toHaveLength(1);
    expect(searchEntries[0].title).toContain("Changelog reliability");
  });

  it("respects date boundaries when filtering bundled updates", async () => {
    supabaseClientMock.mockImplementation(() => {
      throw new Error("Supabase unavailable");
    });

    const { entries } = await listUpdates({
      startDate: "2025-02-10T00:00:00.000Z",
      endDate: "2025-02-13T23:59:59.999Z",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("2025-02-12-ux-refinements");
  });

  it("uses bundled updates when Supabase returns no rows on the initial page", async () => {
    supabaseClientMock.mockReturnValue(
      createSupabaseClientMock({ data: [], error: null }) as never,
    );

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await listUpdates({ limit: 3 });

    expect(infoSpy).toHaveBeenCalledWith(
      "Supabase returned no changelog entries. Falling back to bundled dataset.",
    );
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].timestamp >= result.entries[1].timestamp).toBe(true);
  });

  it("returns Supabase rows when data is available", async () => {
    const supabaseRows = [
      {
        id: "2025-03-01-test",
        timestamp: "2025-03-01T10:00:00.000Z",
        title: "Supabase sourced",
        description: "Single entry",
        category: "System",
        version: null,
        author: null,
      },
    ];

    supabaseClientMock.mockReturnValue(
      createSupabaseClientMock({ data: supabaseRows, error: null }) as never,
    );

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await listUpdates();

    expect(infoSpy).not.toHaveBeenCalled();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("2025-03-01-test");
  });
});
