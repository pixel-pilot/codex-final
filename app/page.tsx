import CoreGrid from "./components/CoreGrid";

export default function Home() {
  return (
    <main className="grid-page-shell">
      <div className="grid-heading">
        <h1>Reactive AI Spreadsheet</h1>
        <p>
          Configure and orchestrate large-scale AI text processing with a purpose-built, high-performance
          spreadsheet grid. Paste thousands of inputs at once, monitor status at a glance, and keep system-managed
          columns protected from manual edits.
        </p>
      </div>
      <section className="grid-container">
        <CoreGrid />
      </section>
    </main>
  );
}
