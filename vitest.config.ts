import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    exclude: ["tests/e2e/**"],
    include: ["app/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage",
      exclude: [
        ".next/**",
        "**/next.config.ts",
        "**/playwright.config.ts",
        "**/postcss.config.mjs",
        "**/tailwind.config.*",
        "**/vitest.config.{ts,js}",
        "**/*.test.{ts,tsx}",
        "tests/**",
        "scripts/**",
        "app/layout.tsx",
        "app/page.tsx",
        "lib/**",
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 70,
      },
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
