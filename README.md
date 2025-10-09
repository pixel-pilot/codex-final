# Reactive AI Spreadsheet

Reactive AI Spreadsheet is a high-throughput Next.js workspace for orchestrating large batches of AI text generations. The interface pairs a virtualized grid with live usage analytics, configurable OpenRouter settings, and an automated quality gate that runs on every change.

## Development

```bash
npm install
npm run dev
```

The app is available at [http://localhost:3000](http://localhost:3000).

## Automated QA Suite

The project includes a comprehensive QA pipeline that combines unit/component coverage, accessibility-aware end-to-end smoke tests, and coverage reporting.

### Available commands

| Command | Description |
| --- | --- |
| `npm run test` | Executes Vitest unit and component suites in watchless mode. |
| `npm run test:coverage` | Runs the Vitest suite with coverage instrumentation. |
| `npm run qa:report` | Generates coverage plus `public/qa/latest.json` for the in-app QA dashboard. |
| `npm run dev:ci` | Launches Next.js with Turbopack disabled for deterministic QA and Playwright runs. |
| `npm run e2e` | Runs Playwright end-to-end tests with accessibility checks (spawns `npm run dev:ci`). |

### Continuous integration

`.github/workflows/qa.yml` executes on every push and pull request. The workflow:

1. Installs dependencies and runs unit/component tests.
2. Collects coverage and publishes `public/qa/latest.json`.
3. Installs Playwright browsers and executes the end-to-end suite.
4. Uploads coverage and Playwright artifacts for inspection.

Mark the `QA` workflow as a required status check to block merges on failures.

### QA dashboard in the app

The **Usage & Costs** tab displays the most recent automated QA report. Updating the report locally is as simple as running `npm run qa:report`; CI updates it automatically as part of the workflow.

## Folder structure

- `app/components` – React client components for the grid, settings panel, and usage dashboard.
- `app/components/__tests__` – Vitest suites covering grid behaviors, persistence, settings, and automation state.
- `tests/e2e` – Playwright smoke tests plus accessibility scan.
- `public/qa/latest.json` – Latest QA summary consumed by the dashboard.
- `scripts/generate-qa-report.mjs` – Helper that converts Vitest coverage JSON into the dashboard-friendly summary.

## Accessibility and reliability

The Playwright suite enforces an axe-core accessibility audit, and unit tests validate localStorage persistence, cross-tab synchronization, and error handling to guard against regressions in the grid, toggle loop, settings, and logging subsystems.
