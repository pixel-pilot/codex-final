import type { UpdateRecord } from "./updatesRepository";

const buildDescription = (points: string[]): string => points.join("\n");

export const bundledUpdates: UpdateRecord[] = [
  {
    id: "2025-02-16-changelog-resilience",
    timestamp: "2025-02-16T15:00:00.000Z",
    title: "Changelog reliability and offline resilience",
    description: buildDescription([
      "Implemented an offline-ready changelog cache that automatically backfills the feed when Supabase is unavailable.",
      "Ensured pagination, search, and filters continue to operate consistently against bundled release notes.",
      "Documented the behavior so product and QA always see the latest release narrative without manual refreshes.",
    ]),
    category: "System",
    version: "2025.02.3",
    author: "Release Automation",
  },
  {
    id: "2025-02-12-ux-refinements",
    timestamp: "2025-02-12T09:30:00.000Z",
    title: "Experience polish for workspace navigation",
    description: buildDescription([
      "Refined layout spacing for the dashboard cards to improve scan-ability at 1024px viewports.",
      "Added persistent keyboard focus outlines across the navigation rail and quick actions.",
      "Expanded semantic labelling for assistive technologies on primary workspace controls.",
    ]),
    category: "UI",
    version: "2025.02.2",
    author: "Design Systems Guild",
  },
  {
    id: "2025-02-05-automation-insights",
    timestamp: "2025-02-05T18:45:00.000Z",
    title: "Automation insights and anomaly surfacing",
    description: buildDescription([
      "Surfaced automation run health directly in the Overview with anomaly detection heuristics.",
      "Instrumented trend sparklines for workflow throughput and time-to-recovery KPIs.",
      "Introduced export tooling for weekly status packs to speed stakeholder updates.",
    ]),
    category: "Improvement",
    version: "2025.02.1",
    author: "Intelligence Platform",
  },
  {
    id: "2025-01-28-onboarding-streamlined",
    timestamp: "2025-01-28T12:15:00.000Z",
    title: "Streamlined guided onboarding",
    description: buildDescription([
      "Launched checklist-driven onboarding with progress persistence across sessions.",
      "Provided contextual in-app education for workspace roles and permissions.",
      "Optimized invite flows to cut the median team activation time by 36%.",
    ]),
    category: "Feature",
    version: "2025.01.0",
    author: "Growth Engineering",
  },
];

