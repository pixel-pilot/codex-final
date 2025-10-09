"use client";

import { useCallback, useRef } from "react";

import CoreGrid, { type CoreGridHandle } from "./components/CoreGrid";

export default function Home() {
  const gridRef = useRef<CoreGridHandle>(null);

  const handleCopyInputs = useCallback(() => {
    void gridRef.current?.copyInputs();
  }, []);

  const handleCopyOutputs = useCallback(() => {
    void gridRef.current?.copyOutputs();
  }, []);

  return (
    <main className="grid-page-shell">
      <div className="grid-heading">
        <div className="grid-heading-content">
          <h1>Reactive AI Spreadsheet</h1>
          <p>
            Configure and orchestrate large-scale AI text processing with a purpose-built, high-performance
            spreadsheet grid. Paste thousands of inputs at once, monitor status at a glance, and keep system-managed
            columns protected from manual edits.
          </p>
        </div>
        <div className="grid-actions">
          <button type="button" onClick={handleCopyInputs}>
            Copy All Inputs
          </button>
          <button type="button" onClick={handleCopyOutputs}>
            Copy All Outputs
          </button>
        </div>
      </div>
      <section className="grid-container">
        <CoreGrid ref={gridRef} />
      </section>
    </main>
  );
}
