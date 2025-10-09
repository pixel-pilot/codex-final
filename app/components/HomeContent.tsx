"use client";

import { useEffect, useMemo, useState } from "react";
import CoreGrid, {
  INITIAL_ROW_COUNT,
  GridRow,
  createInitialRows,
  ensureRowInitialized,
} from "./CoreGrid";
import SettingsPanel from "./SettingsPanel";

type TabId = "generate" | "settings" | "usage";

const TABS: { id: TabId; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "settings", label: "Settings" },
  { id: "usage", label: "Usage & Costs" },
];

type UsageEntry = {
  id: string;
  rowId: string;
  inputPreview: string;
  outputPreview: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  timestamp: string;
};

const seedRows = (): GridRow[] => {
  const base = createInitialRows(INITIAL_ROW_COUNT);

  if (!base.length) {
    return base;
  }

  const now = new Date();
  const iso = now.toISOString();
  const examples: Array<Partial<GridRow>> = [
    {
      status: "Complete",
      input: "Summarize the attached product manual into three key takeaways.",
      output:
        "1. Highlight safety lock usage. 2. Outline maintenance cadence. 3. Share escalation contacts for faults.",
      lastUpdated: iso,
      errorStatus: "",
    },
    {
      status: "In Progress",
      input: "Rewrite this paragraph for executive tone.",
      output: "",
      lastUpdated: iso,
      errorStatus: "",
    },
    {
      status: "Pending",
      input: "Draft an outreach email introducing the beta analytics dashboard.",
      output: "",
      lastUpdated: iso,
      errorStatus: "",
    },
  ];

  const next = [...base];

  for (let i = 0; i < examples.length && i < next.length; i += 1) {
    next[i] = ensureRowInitialized({ ...next[i], ...examples[i] });
  }

  return next;
};

export default function HomeContent() {
  const [activeTab, setActiveTab] = useState<TabId>("generate");
  const [systemActive, setSystemActive] = useState(false);
  const [rows, setRows] = useState<GridRow[]>(() => seedRows());
  const [dateRange, setDateRange] = useState("last30");

  const toggleSystem = () => {
    setSystemActive((previous) => !previous);
  };

  const { pending, inProgress, complete, totalCost } = useMemo(() => {
    let pendingCount = 0;
    let inProgressCount = 0;
    let completeCount = 0;
    let runningCost = 0;

    rows.forEach((row) => {
      if (row.status === "Pending") {
        pendingCount += 1;
      } else if (row.status === "In Progress") {
        inProgressCount += 1;
      } else if (row.status === "Complete") {
        completeCount += 1;
        runningCost += row.costPerOutput;
      }
    });

    return {
      pending: pendingCount,
      inProgress: inProgressCount,
      complete: completeCount,
      totalCost: runningCost,
    };
  }, [rows]);

  const usageEntries: UsageEntry[] = useMemo(() => {
    return rows
      .filter((row) => row.status === "Complete" && (row.input || row.output))
      .slice(0, 100)
      .map((row, index) => ({
        id: `${row.rowId}-${index}`,
        rowId: row.rowId,
        inputPreview: row.input.slice(0, 80),
        outputPreview: row.output.slice(0, 80),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cost: row.costPerOutput,
        model: "gpt-4-turbo",
        timestamp: row.lastUpdated || new Date().toISOString(),
      }));
  }, [rows]);

  const usageSummary = useMemo(() => {
    return usageEntries.reduce(
      (acc, entry) => {
        acc.totalCost += entry.cost;
        acc.totalInputTokens += entry.inputTokens;
        acc.totalOutputTokens += entry.outputTokens;
        return acc;
      },
      { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 },
    );
  }, [usageEntries]);

  useEffect(() => {
    if (!systemActive) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setRows((previous) => {
        const next = [...previous];
        const nowIso = new Date().toISOString();
        let mutated = false;

        const inProgressIndex = next.findIndex((row) => row.status === "In Progress");
        if (inProgressIndex >= 0) {
          const row = next[inProgressIndex];
          const generatedOutput = row.output || `Processed: ${row.input.slice(0, 80)}`;
          next[inProgressIndex] = ensureRowInitialized({
            ...row,
            status: "Complete",
            output: generatedOutput,
            lastUpdated: nowIso,
          });
          mutated = true;
        } else {
          const pendingIndex = next.findIndex((row) => row.status === "Pending");
          if (pendingIndex >= 0) {
            const row = next[pendingIndex];
            next[pendingIndex] = ensureRowInitialized({
              ...row,
              status: "In Progress",
              lastUpdated: nowIso,
            });
            mutated = true;
          }
        }

        return mutated ? next : previous;
      });
    }, 2500);

    return () => window.clearInterval(interval);
  }, [setRows, systemActive]);

  const renderGenerateView = () => {
    const costLabel = systemActive ? "Running cost" : "Completed cost";

    return (
      <section className="generate-container" aria-label="AI generation workspace">
        <div className="generate-topline">
          <div className="generate-topline__block">
            <h2 className="generate-topline__title">
              System control <span className="hint-icon">(?)</span>
            </h2>
            <p className="generate-topline__text">
              Toggle the generator when you are ready to process queued rows. Status counters update live so you can
              see what is waiting, running, or finished.
            </p>
          </div>
          <button
            type="button"
            className={`system-toggle${systemActive ? " system-toggle--active" : ""}`}
            onClick={toggleSystem}
            aria-pressed={systemActive}
          >
            <span className="system-toggle__state">{systemActive ? "On" : "Off"}</span>
            <span className="system-toggle__caption">Generation</span>
          </button>
        </div>
        <div className="generate-metrics" role="list">
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">Pending rows</span>
            <span className="generate-metric__value">{pending.toLocaleString()}</span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">In progress</span>
            <span className="generate-metric__value">{inProgress.toLocaleString()}</span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">Completed</span>
            <span className="generate-metric__value">{complete.toLocaleString()}</span>
          </div>
          <div className="generate-metric" role="listitem">
            <span className="generate-metric__label">
              {costLabel} <span className="hint-icon">(?)</span>
            </span>
            <span className="generate-metric__value">${totalCost.toFixed(4)}</span>
          </div>
        </div>
        <div className="generate-helper">
          <h3>
            Grid operations <span className="hint-icon">(?)</span>
          </h3>
          <p>
            Paste inputs directly into the grid. Alternate row shading keeps scanning simple, and protected columns show
            system-managed values like status, timestamps, and per-output cost.
          </p>
        </div>
        <div className="grid-container" aria-label="AI grid workspace">
          <CoreGrid rows={rows} setRows={setRows} />
        </div>
      </section>
    );
  };

  const renderUsageView = () => (
    <section className="usage-container" aria-label="Usage history and costs">
      <div className="usage-header">
        <div>
          <h2>
            Usage overview <span className="hint-icon">(?)</span>
          </h2>
          <p>
            Track how many tokens you consumed and what you spent over your selected range.
          </p>
        </div>
        <label className="usage-range" htmlFor="usage-range">
          Date range <span className="hint-icon">(?)</span>
          <select
            id="usage-range"
            value={dateRange}
            onChange={(event) => setDateRange(event.currentTarget.value)}
          >
            <option value="last7">Last 7 days</option>
            <option value="last30">Last 30 days</option>
            <option value="last90">Last 90 days</option>
            <option value="custom">Custom range…</option>
          </select>
        </label>
      </div>
      <div className="usage-metrics" role="list">
        <div className="usage-metric" role="listitem">
          <span className="usage-metric__label">Total spent</span>
          <span className="usage-metric__value">${usageSummary.totalCost.toFixed(4)}</span>
        </div>
        <div className="usage-metric" role="listitem">
          <span className="usage-metric__label">Total input tokens</span>
          <span className="usage-metric__value">{usageSummary.totalInputTokens.toLocaleString()}</span>
        </div>
        <div className="usage-metric" role="listitem">
          <span className="usage-metric__label">Total output tokens</span>
          <span className="usage-metric__value">{usageSummary.totalOutputTokens.toLocaleString()}</span>
        </div>
        <div className="usage-metric" role="listitem">
          <span className="usage-metric__label">Completed outputs</span>
          <span className="usage-metric__value">{usageEntries.length.toLocaleString()}</span>
        </div>
      </div>
      <div className="usage-log">
        <div className="usage-log__header">
          <h3>
            Usage log <span className="hint-icon">(?)</span>
          </h3>
          <p>Every completed output is recorded with size, model, and cost details.</p>
        </div>
        <div className="usage-log__table" role="region" aria-label="Usage log entries">
          <table>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Model</th>
                <th scope="col">Input preview</th>
                <th scope="col">Output preview</th>
                <th scope="col">Input tokens</th>
                <th scope="col">Output tokens</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usageEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="usage-log__empty">
                    No completed generations yet. Turn the system on from the Generate tab to start producing outputs.
                  </td>
                </tr>
              ) : (
                usageEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td>{entry.model}</td>
                    <td>{entry.inputPreview || "—"}</td>
                    <td>{entry.outputPreview || "—"}</td>
                    <td className="numeric">{entry.inputTokens.toLocaleString()}</td>
                    <td className="numeric">{entry.outputTokens.toLocaleString()}</td>
                    <td className="numeric">${entry.cost.toFixed(4)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );

  return (
    <main className="grid-page-shell">
      <div className="grid-heading">
        <div className="grid-heading-text">
          <h1>Reactive AI Spreadsheet</h1>
          <p>
            Configure and orchestrate large-scale AI text processing with a purpose-built, high-performance
            spreadsheet grid. Paste thousands of inputs at once, monitor status at a glance, and keep system-managed
            columns protected from manual edits.
          </p>
        </div>
        <nav className="tab-navigation" aria-label="Primary views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-navigation__button${activeTab === tab.id ? " tab-navigation__button--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      {activeTab === "generate" && renderGenerateView()}
      {activeTab === "settings" && (
        <section className="settings-container" aria-label="Application settings">
          <SettingsPanel />
        </section>
      )}
      {activeTab === "usage" && renderUsageView()}
    </main>
  );
}
