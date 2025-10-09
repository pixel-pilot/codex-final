import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Reactive AI Spreadsheet QA", () => {
  test("end-to-end workflow smoke with accessibility audit", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Reactive AI Spreadsheet/i })).toBeVisible();

    const generationToggle = page.getByRole("button", { name: /generation/i });
    await expect(generationToggle).toHaveAttribute("aria-pressed", "false");
    await generationToggle.click();
    await expect(generationToggle).toHaveAttribute("aria-pressed", "true");

    await page.getByPlaceholder("Search input text").fill("Summarize");
    await expect(page.getByText(/rows match/i)).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: /OpenRouter API Connection/i })).toBeVisible();

    await page.getByRole("button", { name: "Usage & Costs" }).click();
    await expect(page.getByRole("heading", { name: /Usage overview/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Automated QA status/i })).toBeVisible();

    const accessibilityScan = await new AxeBuilder({ page }).analyze();
    expect(accessibilityScan.violations).toEqual([]);
  });
});
