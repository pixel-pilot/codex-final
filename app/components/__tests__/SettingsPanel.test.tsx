import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "../SettingsPanel";
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
      saveSettingsState.mockReset();
      subscribeToSettingsState.mockReset();
      loadModelCatalog.mockReset();
      saveModelCatalog.mockReset();
      subscribeToModelCatalog.mockReset();
    },
  } satisfies Partial<SettingsRepositoryModule> & {
    __setSettings: (payload: PersistedSettingsState | null) => void;
    __setCatalog: (payload: PersistedModelCatalog | null) => void;
    __getSettings: () => PersistedSettingsState | null;
    __getCatalog: () => PersistedModelCatalog | null;
    __reset: () => void;
  };
}

const settingsRepositoryMock: ReturnType<typeof createSettingsRepositoryMock> =
  vi.hoisted(
    () => createSettingsRepositoryMock() as ReturnType<typeof createSettingsRepositoryMock>,
  );

vi.mock("../../../lib/settingsRepository", () => settingsRepositoryMock);

describe("SettingsPanel", () => {
  beforeEach(() => {
    settingsRepositoryMock.__reset();
    vi.restoreAllMocks();
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

    const lastCallIndex =
      settingsRepositoryMock.saveSettingsState.mock.calls.length - 1;
    expect(lastCallIndex).toBeGreaterThanOrEqual(0);
    const persisted =
      settingsRepositoryMock.saveSettingsState.mock.calls[lastCallIndex][0];
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
