import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  PersistedModelCatalog,
  PersistedSettingsState,
} from "../../../lib/settingsRepository";

type SettingsRepositoryModule = typeof import("../../../lib/settingsRepository");

function createSettingsRepositoryMock() {
  let settingsState: PersistedSettingsState | null = null;
  let catalogState: PersistedModelCatalog | null = null;
  const settingsListeners = new Set<(payload: PersistedSettingsState | null) => void>();
  const catalogListeners = new Set<(payload: PersistedModelCatalog | null) => void>();
  const loadSettingsState = vi.fn(async () => settingsState);
  const saveSettingsState = vi.fn(async (payload: PersistedSettingsState) => {
    settingsState = payload;
    settingsListeners.forEach((listener) => listener(payload));
  });
  const subscribeToSettingsState = vi.fn(
    (handler: (payload: PersistedSettingsState | null) => void) => {
      settingsListeners.add(handler);
      return () => {
        settingsListeners.delete(handler);
      };
    },
  );
  const loadModelCatalog = vi.fn(async () => catalogState);
  const saveModelCatalog = vi.fn(async (payload: PersistedModelCatalog) => {
    catalogState = payload;
    catalogListeners.forEach((listener) => listener(payload));
  });
  const subscribeToModelCatalog = vi.fn(
    (handler: (payload: PersistedModelCatalog | null) => void) => {
      catalogListeners.add(handler);
      return () => {
        catalogListeners.delete(handler);
      };
    },
  );

  return {
    loadSettingsState,
    saveSettingsState,
    subscribeToSettingsState,
    loadModelCatalog,
    saveModelCatalog,
    subscribeToModelCatalog,
    __setSettings(payload: PersistedSettingsState | null) {
      settingsState = payload;
    },
    __setCatalog(payload: PersistedModelCatalog | null) {
      catalogState = payload;
    },
    __getSettings: () => settingsState,
    __getCatalog: () => catalogState,
    __reset() {
      settingsState = null;
      catalogState = null;
      settingsListeners.clear();
      catalogListeners.clear();
      loadSettingsState.mockReset();
      loadSettingsState.mockImplementation(async () => settingsState);
      saveSettingsState.mockReset();
      saveSettingsState.mockImplementation(async (payload: PersistedSettingsState) => {
        settingsState = payload;
        settingsListeners.forEach((listener) => listener(payload));
      });
      subscribeToSettingsState.mockReset();
      subscribeToSettingsState.mockImplementation(
        (handler: (payload: PersistedSettingsState | null) => void) => {
          settingsListeners.add(handler);
          return () => {
            settingsListeners.delete(handler);
          };
        },
      );
      loadModelCatalog.mockReset();
      loadModelCatalog.mockImplementation(async () => catalogState);
      saveModelCatalog.mockReset();
      saveModelCatalog.mockImplementation(async (payload: PersistedModelCatalog) => {
        catalogState = payload;
        catalogListeners.forEach((listener) => listener(payload));
      });
      subscribeToModelCatalog.mockReset();
      subscribeToModelCatalog.mockImplementation(
        (handler: (payload: PersistedModelCatalog | null) => void) => {
          catalogListeners.add(handler);
          return () => {
            catalogListeners.delete(handler);
          };
        },
      );
    },
  } satisfies Partial<SettingsRepositoryModule> & {
    __setSettings: (payload: PersistedSettingsState | null) => void;
    __setCatalog: (payload: PersistedModelCatalog | null) => void;
    __getSettings: () => PersistedSettingsState | null;
    __getCatalog: () => PersistedModelCatalog | null;
    __reset: () => void;
  };
}

const settingsRepositoryMock: ReturnType<typeof createSettingsRepositoryMock> = vi.hoisted(
  () => createSettingsRepositoryMock() as ReturnType<typeof createSettingsRepositoryMock>,
);

const SETTINGS_REPOSITORY_PATH = "../../../lib/settingsRepository";
const SUPABASE_CLIENT_PATH = "../../../lib/supabaseClient";

const importSettingsPanel = async () => (await import("../SettingsPanel")).default;

const mockSettingsRepositoryModule = () => {
  vi.doMock(SETTINGS_REPOSITORY_PATH, () => ({
    __esModule: true,
    ...settingsRepositoryMock,
  }));
};

const unmockSettingsRepositoryModule = () => {
  vi.doUnmock(SETTINGS_REPOSITORY_PATH);
};

describe("SettingsPanel", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    settingsRepositoryMock.__reset();
    mockSettingsRepositoryModule();
  });

  afterEach(() => {
    unmockSettingsRepositoryModule();
  });

  it("hydrates persisted preferences, prunes stale notifications, and persists updates", async () => {
    const freshTimestamp = Date.now() - 60 * 60 * 1000;
    const staleTimestamp = Date.now() - 80 * 60 * 60 * 1000;

    const settingsPayload: PersistedSettingsState = {
      apiKey: "sk-or-abcdefghijklmnop",
      selectedModelId: "gpt-awesome",
      webSearchEnabled: true,
      maxTokens: "8192",
      temperature: 0.4,
      repetitionPenalty: "1.1",
      topP: 0.9,
      topK: "50",
      reasoningLevel: "deep",
      rateLimitPerMinute: 140,
      knownModelIds: ["gpt-awesome", ""],
      modelNotifications: [
        { id: "fresh", name: "Fresh Model", timestamp: freshTimestamp },
        { id: "stale", name: "Stale Model", timestamp: staleTimestamp },
      ],
    };

    const catalogPayload: PersistedModelCatalog = {
      models: [
        { id: "gpt-awesome", name: "Awesome", pricing: { prompt: 0.001, completion: 0.002 } },
      ],
      lastFetchedAt: Date.now() - 1000,
      storedAt: Date.now(),
    };

    settingsRepositoryMock.__setSettings(settingsPayload);
    settingsRepositoryMock.__setCatalog(catalogPayload);

    const SettingsPanel = await importSettingsPanel();

    render(<SettingsPanel />);

    const apiKeyInput = await screen.findByLabelText("API Key");
    expect((apiKeyInput as HTMLInputElement).value).toBe("sk-or-abcdefghijklmnop");

    const maxTokensInput = screen.getByLabelText("Max Tokens");
    expect((maxTokensInput as HTMLInputElement).value).toBe("8192");

    const topKInput = screen.getByLabelText("Top-K");
    expect((topKInput as HTMLInputElement).value).toBe("50");

    const toggle = screen.getByRole("button", { name: /recently added models/i });
    const notificationsRegion = toggle.closest(".settings-notifications");
    expect(notificationsRegion).not.toBeNull();
    await userEvent.click(toggle);
    const items = within(notificationsRegion as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("Fresh Model")).toBeInTheDocument();

    const webSearchToggle = screen.getByLabelText("Enable OpenRouter web search augmentation");
    expect((webSearchToggle as HTMLInputElement).checked).toBe(true);
    await userEvent.click(webSearchToggle);
    expect((webSearchToggle as HTMLInputElement).checked).toBe(false);

    await waitFor(() => {
      expect(settingsRepositoryMock.saveSettingsState).toHaveBeenCalled();
    });

    const lastCallIndex = settingsRepositoryMock.saveSettingsState.mock.calls.length - 1;
    expect(lastCallIndex).toBeGreaterThanOrEqual(0);
    const persisted = settingsRepositoryMock.saveSettingsState.mock.calls[lastCallIndex][0];
    expect(persisted.webSearchEnabled).toBe(false);
    expect(persisted.modelNotifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "fresh" })]),
    );
    expect(persisted.modelNotifications).toHaveLength(1);
  });

  it("fetches models, records notifications, and caches the catalog", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (typeof input === "string" && input.includes("models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "meta/llama",
                name: "Meta Llama",
                description: "Fast model",
                pricing: { prompt: 0.002, completion: 0.004 },
              },
            ],
          }),
        } as Response;
      }

      throw new Error("Unexpected request");
    });

    const SettingsPanel = await importSettingsPanel();

    render(<SettingsPanel />);

    const fetchButton = await screen.findByRole("button", { name: /refresh models/i });
    await userEvent.click(fetchButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    const dropdownTrigger = screen.getByRole("button", { name: /available/ });
    await userEvent.click(dropdownTrigger);

    const option = await screen.findByRole("option", { name: /meta llama/i });
    expect(option).toBeInTheDocument();

    const notificationsToggle = screen.getByRole("button", { name: /recently added models/i });
    const notificationsContainer = notificationsToggle.closest(".settings-notifications");
    expect(notificationsContainer).not.toBeNull();
    await userEvent.click(notificationsToggle);
    expect(within(notificationsContainer as HTMLElement).getAllByRole("listitem")).toHaveLength(1);

    await waitFor(() => {
      expect(settingsRepositoryMock.saveModelCatalog).toHaveBeenCalled();
    });

    const lastCallIndex = settingsRepositoryMock.saveModelCatalog.mock.calls.length - 1;
    expect(lastCallIndex).toBeGreaterThanOrEqual(0);
    const persistedCatalog = settingsRepositoryMock.saveModelCatalog.mock.calls[lastCallIndex][0];
    expect(persistedCatalog.models?.[0]?.id).toBe("meta/llama");
  });

  it("validates API keys and reports failures", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const SettingsPanel = await importSettingsPanel();

    render(<SettingsPanel />);

    const apiKeyInput = await screen.findByLabelText("API Key");
    await userEvent.type(apiKeyInput, "sk-or-validapikeyvalue");

    const validateButton = screen.getByRole("button", { name: /validate key/i });
    await userEvent.click(validateButton);

    const failureMessage = await screen.findByText(/validation failed/i);
    expect(failureMessage).toBeInTheDocument();

    await userEvent.click(validateButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsPanel persistence fallback", () => {
  const setupLocalStorage = () => {
    const storage = new Map<string, string>();

    const localStorageStub: Storage = {
      get length() {
        return storage.size;
      },
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
    };

    Object.defineProperty(window, "localStorage", {
      value: localStorageStub,
      configurable: true,
    });

    return { storage, localStorageStub };
  };

  const setupBroadcastChannel = () => {
    type Listener = (event: MessageEvent) => void;
    const listenersByName = new Map<string, Map<EventListenerOrEventListenerObject, Listener>>();

    class BroadcastChannelStub implements BroadcastChannel {
      static listenerRegistry = new Map<string, Set<Listener>>();
      readonly name: string;
      onmessage: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;
      onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => unknown) | null = null;

      constructor(name: string) {
        this.name = name;
        if (!BroadcastChannelStub.listenerRegistry.has(name)) {
          BroadcastChannelStub.listenerRegistry.set(name, new Set());
        }
        if (!listenersByName.has(name)) {
          listenersByName.set(name, new Map());
        }
      }

      postMessage(message: unknown): void {
        const listeners = BroadcastChannelStub.listenerRegistry.get(this.name);
        if (!listeners) {
          return;
        }

        const event = new MessageEvent("message", { data: message, origin: "" });
        listeners.forEach((listener) => listener.call(this, event));
        this.onmessage?.call(this, event);
      }

      close(): void {
        const listeners = BroadcastChannelStub.listenerRegistry.get(this.name);
        const instanceRegistry = listenersByName.get(this.name);
        instanceRegistry?.forEach((handler) => {
          listeners?.delete(handler);
        });
        instanceRegistry?.clear();
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type !== "message") {
          return;
        }

        const listeners = BroadcastChannelStub.listenerRegistry.get(this.name);
        const instanceRegistry = listenersByName.get(this.name);
        if (!listeners || !instanceRegistry) {
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
        instanceRegistry.set(listener, handler);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        if (type !== "message") {
          return;
        }

        const listeners = BroadcastChannelStub.listenerRegistry.get(this.name);
        const instanceRegistry = listenersByName.get(this.name);
        if (!listeners || !instanceRegistry) {
          return;
        }

        const handler = instanceRegistry.get(listener);
        if (handler) {
          listeners.delete(handler);
          instanceRegistry.delete(listener);
        }
      }

      dispatchEvent(_event: Event): boolean {
        return false;
      }
    }

    vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);

    return { BroadcastChannelStub };
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setupLocalStorage();
    setupBroadcastChannel();
    vi.doMock(SUPABASE_CLIENT_PATH, () => ({
      getSupabaseClient: () => {
        throw new Error("Supabase unavailable");
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock(SUPABASE_CLIENT_PATH);
    delete (window as Partial<Window>).localStorage;
  });

  it("persists settings locally when Supabase cannot be instantiated", async () => {
    const SettingsPanel = await importSettingsPanel();

    const { unmount } = render(<SettingsPanel />);

    const apiKeyInput = await screen.findByLabelText("API Key");
    await userEvent.clear(apiKeyInput);
    await userEvent.type(apiKeyInput, "sk-or-fallbackapikey1234");

    const webSearchToggle = screen.getByLabelText("Enable OpenRouter web search augmentation");
    expect((webSearchToggle as HTMLInputElement).checked).toBe(false);
    await userEvent.click(webSearchToggle);

    await waitFor(() => {
      const stored = window.localStorage.getItem("app_state:settings_preferences");
      expect(stored).toContain("sk-or-fallbackapikey1234");
    });

    unmount();

    const secondRender = render(<SettingsPanel />);

    const persistedApiKey = await screen.findByLabelText("API Key");
    expect((persistedApiKey as HTMLInputElement).value).toBe("sk-or-fallbackapikey1234");

    const persistedWebToggle = screen.getByLabelText("Enable OpenRouter web search augmentation");
    expect((persistedWebToggle as HTMLInputElement).checked).toBe(true);

    secondRender.unmount();
  });

  it("persists settings locally when Supabase operations fail", async () => {
    const supabaseClient = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("select failed");
            },
          }),
        }),
        upsert: async () => {
          throw new Error("upsert failed");
        },
      })),
      channel: vi.fn(() => {
        throw new Error("channel failed");
      }),
      removeChannel: vi.fn(),
    };

    vi.doMock(SUPABASE_CLIENT_PATH, () => ({
      getSupabaseClient: () => supabaseClient,
    }));

    const SettingsPanel = await importSettingsPanel();

    const { unmount } = render(<SettingsPanel />);

    const apiKeyInput = await screen.findByLabelText("API Key");
    await userEvent.clear(apiKeyInput);
    await userEvent.type(apiKeyInput, "sk-or-rejecting12345");

    const webSearchToggle = screen.getByLabelText(
      "Enable OpenRouter web search augmentation",
    );
    expect((webSearchToggle as HTMLInputElement).checked).toBe(false);
    await userEvent.click(webSearchToggle);

    await waitFor(() => {
      const stored = window.localStorage.getItem("app_state:settings_preferences");
      expect(stored).toContain("sk-or-rejecting12345");
    });

    unmount();

    const rerender = render(<SettingsPanel />);

    const persistedApiKey = await screen.findByLabelText("API Key");
    expect((persistedApiKey as HTMLInputElement).value).toBe("sk-or-rejecting12345");

    const persistedWebToggle = screen.getByLabelText(
      "Enable OpenRouter web search augmentation",
    );
    expect((persistedWebToggle as HTMLInputElement).checked).toBe(true);

    rerender.unmount();
  });
});
