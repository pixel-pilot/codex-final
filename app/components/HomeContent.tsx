"use client";

import { useState } from "react";
import CoreGrid from "./CoreGrid";
import SettingsPanel from "./SettingsPanel";

const TABS = [
  { id: "grid" as const, label: "Grid" },
  { id: "settings" as const, label: "Settings" },
];

export default function HomeContent() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("grid");

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
      {activeTab === "grid" ? (
        <section className="grid-container" aria-label="AI grid workspace">
          <CoreGrid />
        </section>
      ) : (
        <section className="settings-container" aria-label="Application settings">
          <SettingsPanel />
        </section>
      )}
    </main>
  );
}
