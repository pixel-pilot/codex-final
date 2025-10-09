import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const COVERAGE_FILE = resolve("coverage/coverage-final.json");
const OUTPUT_FILE = resolve("public/qa/latest.json");

async function readCoverage() {
  try {
    const raw = await readFile(COVERAGE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("Unable to read coverage summary", error);
    return null;
  }
}

function summarizeEntry(entry) {
  const statementTotal = Object.keys(entry.statementMap ?? {}).length;
  const statementHits = Object.values(entry.s ?? {});
  const statementCovered = statementHits.filter((count) => count > 0).length;

  const branchSets = Object.values(entry.b ?? {});
  const branchTotal = branchSets.reduce((acc, hits) => acc + hits.length, 0);
  const branchCovered = branchSets.reduce(
    (acc, hits) => acc + hits.filter((count) => count > 0).length,
    0,
  );

  const functionTotal = Object.keys(entry.fnMap ?? {}).length;
  const functionHits = Object.values(entry.f ?? {});
  const functionCovered = functionHits.filter((count) => count > 0).length;

  // Treat line coverage as equivalent to statement coverage for this summary.
  return {
    statements: { covered: statementCovered, total: statementTotal },
    branches: { covered: branchCovered, total: branchTotal },
    functions: { covered: functionCovered, total: functionTotal },
    lines: { covered: statementCovered, total: statementTotal },
  };
}

function combineCoverage(target, delta) {
  for (const key of Object.keys(target)) {
    target[key].covered += delta[key].covered;
    target[key].total += delta[key].total;
  }
}

function computePercent({ covered, total }) {
  if (!total) {
    return null;
  }
  return Number(((covered / total) * 100).toFixed(2));
}

async function buildSummary(payload) {
  if (!payload) {
    return {
      generatedAt: new Date().toISOString(),
      coverage: null,
      note: "Coverage data unavailable. Ensure tests ran with --coverage.",
    };
  }

  const accumulator = {
    statements: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };

  Object.values(payload).forEach((fileEntry) => {
    if (!fileEntry || typeof fileEntry !== "object") {
      return;
    }

    if (typeof fileEntry.path !== "string" || !fileEntry.path.includes("/app/components/")) {
      return;
    }

    const summary = summarizeEntry(fileEntry);
    combineCoverage(accumulator, summary);
  });

  const coverage = Object.fromEntries(
    Object.entries(accumulator).map(([metric, totals]) => [metric, computePercent(totals)]),
  );

  return {
    generatedAt: new Date().toISOString(),
    coverage,
  };
}

async function writeReport(report) {
  const directory = dirname(OUTPUT_FILE);
  await mkdir(directory, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2));
}

async function main() {
  const coverage = await readCoverage();
  const report = await buildSummary(coverage);
  await writeReport(report);
  console.log(`QA report generated at ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error("Failed to generate QA report", error);
  process.exitCode = 1;
});
