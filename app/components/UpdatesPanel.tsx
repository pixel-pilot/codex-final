"use client";

import { useEffect, useMemo, useState } from "react";
import { useUpdatesStore } from "../stores/updatesStore";
import type { UpdateRecord } from "../../lib/updatesRepository";

const categoryOptions: Array<UpdateRecord["category"] | "All"> = [
  "All",
  "Feature",
  "Fix",
  "Improvement",
  "UI",
  "System",
  "Note",
];

const formatDateTime = (value: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

const getCategoryClass = (category: UpdateRecord["category"]) => {
  switch (category) {
    case "Feature":
      return "category-chip category-chip--feature";
    case "Fix":
      return "category-chip category-chip--fix";
    case "Improvement":
      return "category-chip category-chip--improvement";
    case "UI":
      return "category-chip category-chip--ui";
    case "System":
      return "category-chip category-chip--system";
    default:
      return "category-chip";
  }
};

export default function UpdatesPanel() {
  const {
    entries,
    initialize,
    refresh,
    loadMore,
    loading,
    error,
    nextCursor,
    filters,
    setFilters,
    markAllRead,
    lastViewed,
  } = useUpdatesStore();

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [autoRefreshEnabled, refresh]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", visibilityHandler);

    return () => document.removeEventListener("visibilitychange", visibilityHandler);
  }, [autoRefreshEnabled, refresh]);

  const hasUnread = useMemo(() => {
    if (!lastViewed) {
      return entries.length > 0;
    }

    return entries.some((entry) => entry.timestamp > lastViewed);
  }, [entries, lastViewed]);

  const handleDateChange = (type: "startDate" | "endDate", value: string) => {
    if (!value) {
      setFilters({ [type]: null });
      return;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    if (type === "startDate") {
      parsed.setHours(0, 0, 0, 0);
    } else {
      parsed.setHours(23, 59, 59, 999);
    }

    setFilters({ [type]: parsed.toISOString() });
  };

  return (
    <div className="updates-panel">
      <div className="updates-panel__header">
        <div className="updates-panel__title-group">
          <h2>Latest Updates</h2>
          <p>
            Automatic changelog generated from deployments, merges, and internal
            notes. Newest entries appear first.
          </p>
        </div>
        <div className="updates-panel__actions">
          <button
            type="button"
            className="updates-panel__button"
            onClick={() => {
              void refresh();
            }}
            disabled={loading}
          >
            Refresh
          </button>
          <label className="updates-panel__autorefresh">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(event) => setAutoRefreshEnabled(event.target.checked)}
            />
            Auto-refresh
          </label>
          <button
            type="button"
            className="updates-panel__button"
            onClick={markAllRead}
            disabled={!hasUnread}
          >
            Mark as read
          </button>
        </div>
      </div>

      <div className="updates-panel__filters">
        <label>
          Category
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters({
                category: event.target.value as UpdateRecord["category"] | "All",
              })
            }
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="updates-panel__search">
          Search
          <input
            type="search"
            placeholder="Search titles or descriptions"
            value={filters.search}
            onChange={(event) => setFilters({ search: event.target.value })}
          />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={filters.startDate ? filters.startDate.slice(0, 10) : ""}
            onChange={(event) => handleDateChange("startDate", event.target.value)}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={filters.endDate ? filters.endDate.slice(0, 10) : ""}
            onChange={(event) => handleDateChange("endDate", event.target.value)}
          />
        </label>
      </div>

      {error && <div className="updates-panel__error">{error}</div>}

      <div className="updates-list" role="feed" aria-busy={loading}>
        {entries.map((entry) => {
          const isUnread = !lastViewed || entry.timestamp > lastViewed;
          const bulletPoints = entry.description
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          return (
            <article
              key={entry.id}
              className={`updates-list__item${
                isUnread ? " updates-list__item--unread" : ""
              }`}
              aria-live="polite"
            >
              <div className="updates-list__meta">
                <span className={getCategoryClass(entry.category)}>
                  {entry.category}
                </span>
                <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
              </div>
              <div className="updates-list__content">
                <h3>{entry.title}</h3>
                {bulletPoints.length > 1 ? (
                  <ul>
                    {bulletPoints.map((line, index) => (
                      <li key={`${entry.id}-${index}`}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{bulletPoints[0] ?? entry.description}</p>
                )}
              </div>
              <div className="updates-list__footer">
                {entry.author && <span>By {entry.author}</span>}
                {entry.version && <span>Version {entry.version}</span>}
              </div>
            </article>
          );
        })}

        {!loading && entries.length === 0 && (
          <div className="updates-list__empty">
            No updates match the selected filters yet.
          </div>
        )}
      </div>

      <div className="updates-panel__footer">
        <button
          type="button"
          className="updates-panel__button"
          onClick={() => void loadMore()}
          disabled={loading || !nextCursor}
        >
          {nextCursor ? "Load more" : "All caught up"}
        </button>
      </div>
    </div>
  );
}
