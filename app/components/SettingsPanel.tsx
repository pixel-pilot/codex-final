"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ModelNotification,
  type OpenRouterModel,
  type PersistedModelCatalog,
  type PersistedSettingsState,
  loadModelCatalog,
  loadSettingsState,
  saveModelCatalog,
  saveSettingsState,
  subscribeToModelCatalog,
  subscribeToSettingsState,
} from "../../lib/settingsRepository";

const NOTIFICATION_TTL_MS = 72 * 60 * 60 * 1000;
const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

const API_KEY_PATTERN = /^sk-or-[a-zA-Z0-9]{16,}$/;

const coerceNumericSetting = (value: unknown, fallback: number | ""): number | "" => {
  if (value === "") {
    return "";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value.trim());
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
};

const sanitizeNotifications = (entries: unknown): ModelNotification[] => {
  if (!Array.isArray(entries)) {
    return [];
  }

  const now = Date.now();

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<ModelNotification>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.timestamp !== "number"
      ) {
        return null;
      }

      if (!Number.isFinite(candidate.timestamp) || now - candidate.timestamp > NOTIFICATION_TTL_MS) {
        return null;
      }

      return candidate as ModelNotification;
    })
    .filter((entry): entry is ModelNotification => Boolean(entry));
};

const formatPriceValue = (value?: number | string | null): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${value.toFixed(4)}`;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    return `$${numeric.toFixed(4)}`;
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return undefined;
};

const formatPricingLabel = (model: OpenRouterModel): string => {
  const promptPrice = formatPriceValue(model.pricing?.prompt);
  const completionPrice = formatPriceValue(model.pricing?.completion);

  if (promptPrice || completionPrice) {
    const segments: string[] = [];
    if (promptPrice) {
      segments.push(`Prompt ${promptPrice}`);
    }
    if (completionPrice) {
      segments.push(`Completion ${completionPrice}`);
    }
    return segments.join(" · ");
  }

  return "Pricing unavailable";
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function SettingsPanel() {
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [knownModelIds, setKnownModelIds] = useState<Record<string, true>>({});
  const [modelNotifications, setModelNotifications] = useState<ModelNotification[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [maxTokens, setMaxTokens] = useState<number | "">(4096);
  const [temperature, setTemperature] = useState<number | "">(0.7);
  const [repetitionPenalty, setRepetitionPenalty] = useState<number | "">(1);
  const [topP, setTopP] = useState<number | "">(0.9);
  const [topK, setTopK] = useState<number | "">(40);
  const [reasoningLevel, setReasoningLevel] = useState<"off" | "standard" | "deep">("off");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState<number | "">(120);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isValidatingApiKey, setIsValidatingApiKey] = useState(false);
  const [apiValidationStatus, setApiValidationStatus] = useState<
    { tone: "info" | "success" | "error"; message: string } | null
  >(null);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [catalogHydrated, setCatalogHydrated] = useState(false);
  const [areNotificationsOpen, setAreNotificationsOpen] = useState(false);
  const lastPersistedSettings = useRef<string | null>(null);
  const lastPersistedCatalog = useRef<string | null>(null);

  const applySettingsPayload = (payload: PersistedSettingsState | null) => {
    if (!payload) {
      return;
    }

    setApiKey(typeof payload.apiKey === "string" ? payload.apiKey : "");
    setSelectedModelId(
      typeof payload.selectedModelId === "string" ? payload.selectedModelId : "",
    );
    setWebSearchEnabled(Boolean(payload.webSearchEnabled));
    setMaxTokens((previous) => coerceNumericSetting(payload.maxTokens, previous));
    setTemperature((previous) => coerceNumericSetting(payload.temperature, previous));
    setRepetitionPenalty((previous) =>
      coerceNumericSetting(payload.repetitionPenalty, previous),
    );
    setTopP((previous) => coerceNumericSetting(payload.topP, previous));
    setTopK((previous) => coerceNumericSetting(payload.topK, previous));
    if (
      payload.reasoningLevel === "off" ||
      payload.reasoningLevel === "standard" ||
      payload.reasoningLevel === "deep"
    ) {
      setReasoningLevel(payload.reasoningLevel);
    }
    setRateLimitPerMinute((previous) =>
      coerceNumericSetting(payload.rateLimitPerMinute, previous),
    );
    const entries = Array.isArray(payload.knownModelIds)
      ? payload.knownModelIds.reduce<Record<string, true>>((accumulator, value) => {
          if (typeof value === "string" && value.trim()) {
            accumulator[value] = true;
          }
          return accumulator;
        }, {})
      : {};
    setKnownModelIds(entries);
    setModelNotifications(sanitizeNotifications(payload.modelNotifications));
  };

  const buildSettingsPayload = (): PersistedSettingsState => ({
    apiKey,
    selectedModelId,
    webSearchEnabled,
    maxTokens,
    temperature,
    repetitionPenalty,
    topP,
    topK,
    reasoningLevel,
    rateLimitPerMinute,
    knownModelIds: Object.keys(knownModelIds),
    modelNotifications: sanitizeNotifications(modelNotifications),
  });

  const applyModelCatalogPayload = (payload: PersistedModelCatalog | null) => {
    if (!payload) {
      return;
    }

    if (typeof payload.storedAt !== "number" || Date.now() - payload.storedAt > MODEL_CATALOG_TTL_MS) {
      return;
    }

    const normalizedModels = Array.isArray(payload.models)
      ? payload.models
          .map((model) => {
            if (!model || typeof model !== "object") {
              return null;
            }

            const entry = model as OpenRouterModel;
            if (typeof entry.id !== "string") {
              return null;
            }

            return { ...entry, id: entry.id } satisfies OpenRouterModel;
          })
          .filter((entry): entry is OpenRouterModel => Boolean(entry))
      : [];

    if (normalizedModels.length) {
      normalizedModels.sort((a, b) => a.id.localeCompare(b.id));
      setModels(normalizedModels);
      setKnownModelIds((previous) => {
        const merged = { ...previous };
        for (const model of normalizedModels) {
          merged[model.id] = true;
        }
        return merged;
      });
    }

    if (
      typeof payload.lastFetchedAt === "number" &&
      Number.isFinite(payload.lastFetchedAt)
    ) {
      setLastFetchedAt(payload.lastFetchedAt);
    }
  };

  const buildModelCatalogPayload = (): PersistedModelCatalog => ({
    models,
    lastFetchedAt,
    storedAt: Date.now(),
  });

  useEffect(() => {
    const pruneNotifications = () => {
      const now = Date.now();
      setModelNotifications((previous) =>
        previous.filter((entry) => now - entry.timestamp < NOTIFICATION_TTL_MS),
      );
    };

    pruneNotifications();
    const interval = window.setInterval(pruneNotifications, 60 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const stored = await loadSettingsState();
        if (cancelled) {
          return;
        }

        if (stored) {
          applySettingsPayload(stored);
          lastPersistedSettings.current = JSON.stringify(stored);
        } else {
          lastPersistedSettings.current = null;
        }
      } catch (error) {
        console.error("Unable to restore settings preferences", error);
      } finally {
        if (!cancelled) {
          setSettingsHydrated(true);
        }
      }
    };

    hydrate();

    const unsubscribe = subscribeToSettingsState((payload) => {
      if (cancelled) {
        return;
      }

      const serialized = payload ? JSON.stringify(payload) : null;
      if (serialized === lastPersistedSettings.current) {
        return;
      }

      lastPersistedSettings.current = serialized;
      applySettingsPayload(payload);
      setSettingsHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }

    const payload = buildSettingsPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === lastPersistedSettings.current) {
      return;
    }

    lastPersistedSettings.current = serialized;

    const persist = async () => {
      try {
        await saveSettingsState(payload);
      } catch (error) {
        console.error("Unable to persist settings preferences", error);
      }
    };

    void persist();
  }, [
    apiKey,
    knownModelIds,
    maxTokens,
    modelNotifications,
    rateLimitPerMinute,
    reasoningLevel,
    repetitionPenalty,
    selectedModelId,
    settingsHydrated,
    temperature,
    topK,
    topP,
    webSearchEnabled,
  ]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const stored = await loadModelCatalog();
        if (cancelled) {
          return;
        }

        if (stored) {
          applyModelCatalogPayload(stored);
          lastPersistedCatalog.current = JSON.stringify(stored);
        } else {
          lastPersistedCatalog.current = null;
        }
      } catch (error) {
        console.error("Unable to restore cached model catalog", error);
      } finally {
        if (!cancelled) {
          setCatalogHydrated(true);
        }
      }
    };

    hydrate();

    const unsubscribe = subscribeToModelCatalog((payload) => {
      if (cancelled) {
        return;
      }

      const serialized = payload ? JSON.stringify(payload) : null;
      if (serialized === lastPersistedCatalog.current) {
        return;
      }

      lastPersistedCatalog.current = serialized;
      applyModelCatalogPayload(payload);
      setCatalogHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!catalogHydrated) {
      return;
    }

    if (!models.length) {
      return;
    }

    const payload = buildModelCatalogPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === lastPersistedCatalog.current) {
      return;
    }

    lastPersistedCatalog.current = serialized;

    const persist = async () => {
      try {
        await saveModelCatalog(payload);
      } catch (error) {
        console.error("Unable to persist model catalog", error);
      }
    };

    void persist();
  }, [catalogHydrated, lastFetchedAt, models]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current) {
        return;
      }

      if (!dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isModelDropdownOpen]);

  const apiKeyStatus = useMemo(() => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return {
        type: "info" as const,
        message: "Provide your API key to authenticate requests.",
        showCheckmark: false,
      };
    }

    const isOpenRouterKey = API_KEY_PATTERN.test(trimmed);
    return {
      type: "success" as const,
      message: isOpenRouterKey ? "OpenRouter API key detected." : "API key stored.",
      showCheckmark: true,
    };
  }, [apiKey]);

  const handleFetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    setFetchError(null);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(apiKey.trim()
            ? {
                Authorization: `Bearer ${apiKey.trim()}`,
              }
            : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models (${response.status})`);
      }

      const payload: unknown = await response.json();
      const container =
        payload && typeof payload === "object"
          ? (payload as { data?: unknown; models?: unknown })
          : {};

      const rawModels: unknown = Array.isArray(container.data)
        ? container.data
        : Array.isArray(container.models)
        ? container.models
        : [];

      const parsedModels: OpenRouterModel[] = Array.isArray(rawModels)
        ? (rawModels as unknown[]).reduce<OpenRouterModel[]>((accumulator, entry) => {
            if (!entry || typeof entry !== "object") {
              return accumulator;
            }

            const candidate = entry as Record<string, unknown>;
            const id =
              typeof candidate.id === "string"
                ? candidate.id
                : typeof candidate.slug === "string"
                ? candidate.slug
                : null;

            if (!id) {
              return accumulator;
            }

            const pricing =
              candidate.pricing && typeof candidate.pricing === "object"
                ? (candidate.pricing as OpenRouterModel["pricing"])
                : null;

            const model: OpenRouterModel = {
              id,
              name: typeof candidate.name === "string" ? candidate.name : undefined,
              description: typeof candidate.description === "string" ? candidate.description : undefined,
              pricing,
            };

            accumulator.push(model);
            return accumulator;
          }, [])
        : [];

      parsedModels.sort((a, b) => a.id.localeCompare(b.id));
      setModels(parsedModels);
      setLastFetchedAt(Date.now());

      setSelectedModelId((previous) => {
        if (previous && parsedModels.some((model) => model.id === previous)) {
          return previous;
        }

        return parsedModels[0]?.id ?? "";
      });

      const existingIds = new Set(Object.keys(knownModelIds));
      const newlyDiscovered = parsedModels.filter((model) => !existingIds.has(model.id));

      if (newlyDiscovered.length) {
        const now = Date.now();
        setModelNotifications((previous) => {
          const retained = previous.filter((entry) => now - entry.timestamp < NOTIFICATION_TTL_MS);
          const additions = newlyDiscovered.map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            timestamp: now,
          }));
          return [...retained, ...additions];
        });
      }

      setKnownModelIds((previous) => {
        const merged = { ...previous };
        for (const model of parsedModels) {
          merged[model.id] = true;
        }
        return merged;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch models.";
      setFetchError(message);
    } finally {
      setIsFetchingModels(false);
    }
  }, [apiKey, knownModelIds]);

  const handleValidateApiKey = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setApiValidationStatus({
        tone: "error",
        message: "Enter your OpenRouter API key before validating.",
      });
      return;
    }

    setIsValidatingApiKey(true);
    setApiValidationStatus({ tone: "info", message: "Validating API key…" });

    try {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${trimmedKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Validation failed (${response.status})`);
      }

      setApiValidationStatus({ tone: "success", message: "API key verified successfully." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to validate the API key at this time.";
      setApiValidationStatus({ tone: "error", message });
    } finally {
      setIsValidatingApiKey(false);
    }
  }, [apiKey]);

  const filteredModels = useMemo(() => {
    if (!searchTerm.trim()) {
      return models;
    }

    const normalized = searchTerm.trim().toLowerCase();
    return models.filter((model) => {
      const idMatch = model.id.toLowerCase().includes(normalized);
      const nameMatch = (model.name ?? "").toLowerCase().includes(normalized);
      const descriptionMatch = (model.description ?? "").toLowerCase().includes(normalized);
      return idMatch || nameMatch || descriptionMatch;
    });
  }, [models, searchTerm]);

  const activeNotifications = useMemo(() => {
    const now = Date.now();
    return modelNotifications.filter((entry) => now - entry.timestamp < NOTIFICATION_TTL_MS);
  }, [modelNotifications]);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModelId) {
      return "Select a model";
    }

    const match = models.find((model) => model.id === selectedModelId);
    return match?.name ?? selectedModelId;
  }, [models, selectedModelId]);

  const toggleModelDropdown = useCallback(() => {
    setIsModelDropdownOpen((previous) => !previous);
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    setIsModelDropdownOpen(false);
  }, []);

  const handleNumericChange = useCallback((value: string, setter: (next: number | "") => void) => {
    if (!value.trim()) {
      setter("");
      return;
    }

    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }

    setter(numeric);
  }, []);

  const handleRateLimitChange = useCallback((value: string) => {
    if (!value.trim()) {
      setRateLimitPerMinute("");
      return;
    }

    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }

    const bounded = Math.min(Math.max(Math.round(numeric), 1), 250);
    setRateLimitPerMinute(bounded);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const detailValue = typeof rateLimitPerMinute === "number" ? rateLimitPerMinute : null;
    window.dispatchEvent(
      new CustomEvent("reactive-ai:settings-rate-limit-changed", {
        detail: { value: detailValue },
      }),
    );
  }, [rateLimitPerMinute]);

  return (
    <div className="settings-panel" role="form" aria-describedby="settings-panel-description">
      <p id="settings-panel-description" className="visually-subtle">
        Manage your OpenRouter connection, select preferred text models, and tune advanced inference parameters for
        outgoing requests.
      </p>

      <section className="settings-card" aria-labelledby="openrouter-api-heading">
        <div className="settings-card__header settings-card__header--compact">
          <h2 id="openrouter-api-heading">OpenRouter API Connection</h2>
          <button
            type="button"
            className="settings-action-button"
            onClick={handleValidateApiKey}
            disabled={!apiKey.trim() || isValidatingApiKey}
          >
            {isValidatingApiKey ? "Validating…" : "Validate key"}
          </button>
        </div>
        <div className="settings-field">
          <label htmlFor="openrouter-api-key">API Key</label>
          <input
            id="openrouter-api-key"
            type="password"
            inputMode="text"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.currentTarget.value);
              if (apiValidationStatus) {
                setApiValidationStatus(null);
              }
            }}
            placeholder="sk-or-..."
            aria-describedby="openrouter-api-key-status"
          />
          <div
            id="openrouter-api-key-status"
            className={`settings-field__status settings-field__status--${apiKeyStatus.type}`}
            role="status"
            aria-live="polite"
          >
            {apiKeyStatus.showCheckmark ? (
              <>
                <span className="settings-field__status-icon" aria-hidden="true">
                  ✓
                </span>
                <span className="sr-only">{apiKeyStatus.message}</span>
              </>
            ) : (
              <span>{apiKeyStatus.message}</span>
            )}
          </div>
          {apiValidationStatus && (
            <p
              className={`settings-field__message settings-field__message--${apiValidationStatus.tone}`}
              role={apiValidationStatus.tone === "error" ? "alert" : "status"}
            >
              {apiValidationStatus.message}
            </p>
          )}
        </div>
      </section>

      <section className="settings-card settings-card--model" aria-labelledby="text-models-heading">
        <div className="settings-card__header settings-card__header--compact">
          <div>
            <h2 id="text-models-heading">Select Model</h2>
            <p className="settings-card__description">
              Browse the OpenRouter catalog, compare pricing, and adjust inference parameters side by side.
            </p>
          </div>
          <div className="model-actions" role="group" aria-label="Model utilities">
            <button
              type="button"
              className="settings-action-button"
              onClick={handleFetchModels}
              disabled={isFetchingModels}
            >
              {isFetchingModels ? "Fetching…" : "Refresh Models"}
            </button>
            <div className="model-actions__toggle">
              <label className="model-actions__toggle-control">
                <span className="model-actions__toggle-text">Web Search</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={webSearchEnabled}
                    onChange={(event) => setWebSearchEnabled(event.currentTarget.checked)}
                    aria-label="Enable OpenRouter web search augmentation"
                  />
                  <span className="toggle-switch__slider" aria-hidden="true" />
                </span>
              </label>
              <p className="settings-field__hint model-actions__hint">
                When enabled, requests append <code>:online</code> so supported models use OpenRouter web search augmentation.
              </p>
            </div>
          </div>
        </div>
        <div className="model-config">
          <div className="model-dropdown" ref={dropdownRef}>
            <button
              type="button"
              className="model-dropdown__trigger"
              onClick={toggleModelDropdown}
              aria-expanded={isModelDropdownOpen}
              aria-haspopup="listbox"
            >
              <span className="model-dropdown__label">{selectedModelLabel}</span>
              <span className="model-dropdown__count">{filteredModels.length} available</span>
            </button>
            {isModelDropdownOpen && (
              <div className="model-dropdown__panel" role="listbox" aria-label="OpenRouter models">
                <div className="model-dropdown__search">
                  <input
                    type="search"
                    placeholder="Search by name, slug, or description"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.currentTarget.value)}
                  />
                </div>
                <ul>
                  {filteredModels.length > 0 ? (
                    filteredModels.map((model) => (
                      <li key={model.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedModelId === model.id}
                          onClick={() => handleModelSelect(model.id)}
                        >
                          <span className="model-dropdown__option-name">{model.name ?? model.id}</span>
                          <span className="model-dropdown__option-pricing">{formatPricingLabel(model)}</span>
                          {model.description && (
                            <span className="model-dropdown__option-description">{model.description}</span>
                          )}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="model-dropdown__empty">No models match the current filters.</li>
                  )}
                </ul>
                <div className="model-dropdown__footer">
                  {fetchError ? (
                    <span className="model-dropdown__error" role="alert">
                      {fetchError}
                    </span>
                  ) : lastFetchedAt ? (
                    `Last refreshed ${formatTimestamp(lastFetchedAt)}.`
                  ) : (
                    "Catalog not fetched yet."
                  )}
                </div>
              </div>
            )}
          </div>
            <div className="model-parameters">
              <div className="settings-parameter-grid">
                <div className="settings-field">
                  <label htmlFor="max-tokens">Max Tokens</label>
                  <input
                  id="max-tokens"
                  type="number"
                  min={1}
                  step={1}
                  value={maxTokens}
                  onChange={(event) => handleNumericChange(event.currentTarget.value, setMaxTokens)}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="temperature">Temperature</label>
                <input
                  id="temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.01}
                  value={temperature}
                  onChange={(event) => handleNumericChange(event.currentTarget.value, setTemperature)}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="repetition-penalty">Repetition Penalty</label>
                <input
                  id="repetition-penalty"
                  type="number"
                  min={0}
                  step={0.01}
                  value={repetitionPenalty}
                  onChange={(event) => handleNumericChange(event.currentTarget.value, setRepetitionPenalty)}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="top-p">Top-P</label>
                <input
                  id="top-p"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={topP}
                  onChange={(event) => handleNumericChange(event.currentTarget.value, setTopP)}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="top-k">Top-K</label>
                <input
                  id="top-k"
                  type="number"
                  min={0}
                  step={1}
                  value={topK}
                  onChange={(event) => handleNumericChange(event.currentTarget.value, setTopK)}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="rate-limit">Rate Limit (requests / min)</label>
                <input
                  id="rate-limit"
                  type="number"
                  min={1}
                  max={250}
                  step={1}
                  value={rateLimitPerMinute}
                  onChange={(event) => handleRateLimitChange(event.currentTarget.value)}
                />
                <p className="settings-field__hint">Choose how many requests per minute the generator should target (1–250).</p>
              </div>
              <div className="settings-field">
                <label htmlFor="reasoning-level">Reasoning Effort Level</label>
                <select
                  id="reasoning-level"
                  value={reasoningLevel}
                  onChange={(event) => setReasoningLevel(event.currentTarget.value as typeof reasoningLevel)}
                >
                  <option value="off">Base (no additional reasoning)</option>
                  <option value="standard">Standard (:thinking / reasoning_effort: 1)</option>
                  <option value="deep">Deep (:deep-reasoning / reasoning_effort: 2)</option>
                </select>
                <p className="settings-field__hint">
                  Choose how aggressively the selected model should allocate reasoning tokens. Higher levels improve
                  reliability at additional cost and latency.
                </p>
              </div>
            </div>
          </div>
        </div>
        {!isModelDropdownOpen && fetchError && (
          <p className="settings-field__message settings-field__message--error" role="alert">
            {fetchError}
          </p>
        )}
        {activeNotifications.length > 0 && (
          <div className="settings-notifications" role="region" aria-live="polite">
            <button
              type="button"
              className="settings-notifications__toggle"
              onClick={() => setAreNotificationsOpen((previous) => !previous)}
              aria-expanded={areNotificationsOpen}
              aria-controls="recent-model-notifications"
            >
              <span>Recently added models</span>
              <span className="settings-notifications__badge">{activeNotifications.length}</span>
              <span className="settings-notifications__chevron" aria-hidden="true">
                {areNotificationsOpen ? "▾" : "▸"}
              </span>
            </button>
            {areNotificationsOpen && (
              <ul id="recent-model-notifications">
                {activeNotifications.map((notification) => (
                  <li key={`${notification.id}-${notification.timestamp}`}>
                    <span className="settings-notifications__model">{notification.name}</span>
                    <time dateTime={new Date(notification.timestamp).toISOString()}>
                      Added {formatTimestamp(notification.timestamp)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
