import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "../SettingsPanel";

const SETTINGS_STORAGE_KEY = "reactive-ai-settings-preferences";
const MODEL_CATALOG_STORAGE_KEY = "reactive-ai-model-catalog";

describe("SettingsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("hydrates persisted preferences, prunes stale notifications, and persists updates", async () => {
    const freshTimestamp = Date.now() - 60 * 60 * 1000;
    const staleTimestamp = Date.now() - 80 * 60 * 60 * 1000;

    const settingsPayload = {
      apiKey: "sk-or-abcdefghijklmnop",
      selectedModelId: "gpt-awesome",
      webSearchEnabled: true,
      maxTokens: "8192",
      temperature: 0.4,
      repetitionPenalty: "1.1",
      topP: 0.9,
      topK: "50",
      reasoningLevel: "deep",
      knownModelIds: ["gpt-awesome", ""],
      modelNotifications: [
        { id: "fresh", name: "Fresh Model", timestamp: freshTimestamp },
        { id: "stale", name: "Stale Model", timestamp: staleTimestamp },
      ],
    };

    const catalogPayload = {
      models: [
        { id: "gpt-awesome", name: "Awesome", pricing: { prompt: 0.001, completion: 0.002 } },
      ],
      lastFetchedAt: Date.now() - 1000,
      storedAt: Date.now(),
    };

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsPayload));
    window.localStorage.setItem(MODEL_CATALOG_STORAGE_KEY, JSON.stringify(catalogPayload));

    render(<SettingsPanel />);

    const apiKeyInput = await screen.findByLabelText("API Key");
    expect((apiKeyInput as HTMLInputElement).value).toBe("sk-or-abcdefghijklmnop");

    const maxTokensInput = screen.getByLabelText("Max Tokens");
    expect((maxTokensInput as HTMLInputElement).value).toBe("8192");

    const topKInput = screen.getByLabelText("Top-K");
    expect((topKInput as HTMLInputElement).value).toBe("50");

    const notifications = screen.getByRole("status");
    const items = within(notifications).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("Fresh Model")).toBeInTheDocument();

    const webSearchToggle = screen.getByLabelText("Enable OpenRouter web search augmentation");
    expect((webSearchToggle as HTMLInputElement).checked).toBe(true);
    await userEvent.click(webSearchToggle);
    expect((webSearchToggle as HTMLInputElement).checked).toBe(false);

    await waitFor(() => {
      const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = stored ? JSON.parse(stored) : {};
      expect(parsed.webSearchEnabled).toBe(false);
    });
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

    const fetchButton = await screen.findByRole("button", { name: /refresh catalog/i });
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

    const notifications = screen.getByRole("status");
    expect(within(notifications).getAllByRole("listitem")).toHaveLength(1);

    await waitFor(() => {
      const stored = window.localStorage.getItem(MODEL_CATALOG_STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = stored ? JSON.parse(stored) : {};
      expect(parsed.models?.[0]?.id).toBe("meta/llama");
    });
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
