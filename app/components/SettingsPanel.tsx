"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  pricing?: {
    prompt?: number | string | null;
    completion?: number | string | null;
  } | null;
};

type ModelNotification = {
  id: string;
  name: string;
  timestamp: number;
};

const NOTIFICATION_TTL_MS = 72 * 60 * 60 * 1000;

const API_KEY_PATTERN = /^sk-or-[a-zA-Z0-9]{16,}$/;

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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isValidatingApiKey, setIsValidatingApiKey] = useState(false);
  const [apiValidationStatus, setApiValidationStatus] = useState<
    { tone: "info" | "success" | "error"; message: string } | null
  >(null);

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
    if (!apiKey.trim()) {
      return {
        type: "info" as const,
        message: "Provide your OpenRouter API key to authenticate requests.",
      };
    }

    if (API_KEY_PATTERN.test(apiKey.trim())) {
      return {
        type: "success" as const,
        message: "API key format looks valid.",
      };
    }

    return {
      type: "error" as const,
      message: "OpenRouter API keys begin with sk-or- followed by at least 16 alphanumeric characters.",
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

  const resolvedSelectedModelId = useMemo(() => {
    if (!selectedModelId) {
      return "";
    }

    return filteredModels.some((model) => model.id === selectedModelId) ? selectedModelId : "";
  }, [filteredModels, selectedModelId]);

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
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder="sk-or-..."
            aria-describedby="openrouter-api-key-status"
          />
          <p
            id="openrouter-api-key-status"
            className={`settings-field__message settings-field__message--${apiKeyStatus.type}`}
            role={apiKeyStatus.type === "error" ? "alert" : undefined}
          >
            {apiKeyStatus.message}
          </p>
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
            <h2 id="text-models-heading">Model configuration</h2>
            <p className="settings-card__description">
              Browse the OpenRouter catalog, compare pricing, and adjust inference parameters side by side.
            </p>
          </div>
          <button
            type="button"
            className="settings-action-button"
            onClick={handleFetchModels}
            disabled={isFetchingModels}
          >
            {isFetchingModels ? "Fetching…" : "Refresh catalog"}
          </button>
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
              <span className="model-dropdown__label">
                {resolvedSelectedModelId
                  ? models.find((model) => model.id === resolvedSelectedModelId)?.name ?? resolvedSelectedModelId
                  : "Select a model"}
              </span>
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
                          aria-selected={resolvedSelectedModelId === model.id}
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
          <div className="settings-notifications" role="status" aria-live="polite">
            <h3>Recently added models</h3>
            <ul>
              {activeNotifications.map((notification) => (
                <li key={`${notification.id}-${notification.timestamp}`}>
                  <span className="settings-notifications__model">{notification.name}</span>
                  <time dateTime={new Date(notification.timestamp).toISOString()}>
                    Added {formatTimestamp(notification.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="settings-toggle">
          <span>Web Search</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={webSearchEnabled}
              onChange={(event) => setWebSearchEnabled(event.currentTarget.checked)}
              aria-label="Enable OpenRouter web search augmentation"
            />
            <span className="toggle-switch__slider" aria-hidden="true" />
          </label>
          <p className="settings-field__hint">
            When enabled, requests will append <code>:online</code> to supported models so they use OpenRouter web
            search augmentation.
          </p>
        </div>
      </section>
    </div>
  );
}
