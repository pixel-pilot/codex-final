import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODULE_PATH = "../appStateRepository";
const SUPABASE_PATH = "../supabaseClient";

const setupBroadcastChannelStub = () => {
  type Listener = (event: MessageEvent) => void;
  const listenersByChannel = new Map<string, Set<Listener>>();
  const listenerMappings = new Map<
    string,
    Map<EventListenerOrEventListenerObject, Listener>
  >();

  class BroadcastChannelStub implements BroadcastChannel {
    static register(name: string): Set<Listener> {
      let listeners = listenersByChannel.get(name);
      if (!listeners) {
        listeners = new Set();
        listenersByChannel.set(name, listeners);
      }
      return listeners;
    }

    readonly name: string;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
    onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;

    constructor(name: string) {
      this.name = name;
      BroadcastChannelStub.register(name);
      if (!listenerMappings.has(name)) {
        listenerMappings.set(name, new Map());
      }
    }

    postMessage(message: unknown): void {
      const listeners = listenersByChannel.get(this.name);
      if (!listeners) {
        return;
      }

      const event = new MessageEvent("message", { data: message, origin: "" });
      listeners.forEach((listener) => listener.call(this, event));
      this.onmessage?.call(this, event);
    }

    close(): void {
      const listeners = listenersByChannel.get(this.name);
      listeners?.clear();
      listenerMappings.get(this.name)?.clear();
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      if (type !== "message") {
        return;
      }

      const listeners = BroadcastChannelStub.register(this.name);
      const mapping = listenerMappings.get(this.name);
      if (!mapping) {
        return;
      }
      const handler: Listener = (event: MessageEvent) => {
        if (typeof listener === "function") {
          listener.call(this, event);
        } else {
          listener.handleEvent(event);
        }
      };

      listeners.add(handler);
      mapping.set(listener, handler);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      if (type !== "message") {
        return;
      }

      const listeners = listenersByChannel.get(this.name);
      const mapping = listenerMappings.get(this.name);
      if (!listeners || !mapping) {
        return;
      }

      const handler = mapping.get(listener);
      if (handler) {
        listeners.delete(handler);
        mapping.delete(listener);
      }
    }

    dispatchEvent(_event: Event): boolean {
      return false;
    }
  }

  vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);
};

describe("appStateRepository fallbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    window.localStorage?.clear?.();
    setupBroadcastChannelStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockSupabaseModule = (factory: () => unknown) => {
    vi.doMock(SUPABASE_PATH, () => ({
      __esModule: true,
      ...factory(),
    }));
  };

  it("uses local storage when Supabase select fails", async () => {
    const payload = { answer: 42 };
    window.localStorage.setItem("app_state:test_key", JSON.stringify(payload));

    const getSupabaseClient = vi.fn(() => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("select failed");
            },
          }),
        }),
      }),
    }));

    mockSupabaseModule(() => ({ getSupabaseClient }));

    const { loadState } = await import(MODULE_PATH);
    const result = await loadState<typeof payload>("test_key");

    expect(result).toEqual(payload);
    expect(getSupabaseClient).toHaveBeenCalledTimes(1);
  });

  it("retries Supabase load attempts after a failure", async () => {
    const fallbackPayload = { answer: 42 };
    window.localStorage.setItem(
      "app_state:test_key",
      JSON.stringify(fallbackPayload),
    );

    const remotePayload = { answer: 99 };

    const getSupabaseClient = vi
      .fn()
      .mockImplementationOnce(() => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                throw new Error("select failed");
              },
            }),
          }),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { key: "test_key", payload: remotePayload },
                error: null,
              }),
            }),
          }),
        }),
      }));

    mockSupabaseModule(() => ({ getSupabaseClient }));

    const { loadState } = await import(MODULE_PATH);
    const firstResult = await loadState<typeof fallbackPayload>("test_key");
    expect(firstResult).toEqual(fallbackPayload);

    const secondResult = await loadState<typeof remotePayload>("test_key");
    expect(secondResult).toEqual(remotePayload);
    expect(getSupabaseClient).toHaveBeenCalledTimes(2);
  });

  it("retries Supabase saves after an upsert failure", async () => {
    const failingUpsert = vi.fn(async () => {
      throw new Error("upsert failed");
    });
    const successfulUpsert = vi.fn(async () => ({ error: null }));

    const getSupabaseClient = vi
      .fn()
      .mockImplementationOnce(() => ({
        from: () => ({
          upsert: failingUpsert,
        }),
      }))
      .mockImplementationOnce(() => ({
        from: () => ({
          upsert: successfulUpsert,
        }),
      }));

    mockSupabaseModule(() => ({ getSupabaseClient }));

    const { saveState } = await import(MODULE_PATH);

    const firstPayload = { enabled: true };
    await saveState("persist", firstPayload);
    const storedFirst = window.localStorage.getItem("app_state:persist");
    expect(storedFirst).not.toBeNull();
    expect(JSON.parse(storedFirst as string)).toEqual(firstPayload);
    expect(failingUpsert).toHaveBeenCalledTimes(1);

    const secondPayload = { enabled: false };
    await saveState("persist", secondPayload);

    expect(successfulUpsert).toHaveBeenCalledTimes(1);
    expect(getSupabaseClient).toHaveBeenCalledTimes(2);
  });

  it("reverts subscriptions to local storage when Supabase channels fail", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const getSupabaseClient = vi.fn(() => ({
      channel: () => {
        throw new Error("channel failed");
      },
      from: () => ({
        upsert: async () => {
          throw new Error("upsert failed");
        },
      }),
      removeChannel: vi.fn(),
    }));

    mockSupabaseModule(() => ({ getSupabaseClient }));

    const { saveState, subscribeToState } = await import(MODULE_PATH);

    const handler = vi.fn();
    const unsubscribe = subscribeToState("subscribe", handler);

    await saveState("subscribe", { value: "local" });

    expect(handler).toHaveBeenCalledWith({ value: "local" });
    expect(getSupabaseClient).toHaveBeenCalledTimes(1);

    unsubscribe();
    consoleWarnSpy.mockRestore();
  });

  it("retries Supabase subscriptions after a channel failure", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const failingClient = {
      channel: () => {
        throw new Error("channel failed");
      },
      removeChannel: vi.fn(),
    };

    const channelMock = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(() => ({})),
    };
    const succeedingClient = {
      channel: vi.fn(() => channelMock),
      removeChannel: vi.fn(),
    };

    const getSupabaseClient = vi
      .fn()
      .mockImplementationOnce(() => failingClient)
      .mockImplementationOnce(() => succeedingClient);

    mockSupabaseModule(() => ({ getSupabaseClient }));

    const { subscribeToState } = await import(MODULE_PATH);

    const firstHandler = vi.fn();
    const unsubscribeFirst = subscribeToState("subscribe", firstHandler);
    unsubscribeFirst();

    const secondHandler = vi.fn();
    const unsubscribeSecond = subscribeToState("subscribe", secondHandler);

    expect(getSupabaseClient).toHaveBeenCalledTimes(2);
    expect(channelMock.on).toHaveBeenCalled();
    expect(channelMock.subscribe).toHaveBeenCalledTimes(1);

    unsubscribeSecond();
    consoleWarnSpy.mockRestore();
  });
});
