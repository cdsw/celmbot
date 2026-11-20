import { expect, test } from "@playwright/test";

// Optional Chromium UI pass. Enable with CELMBOT_BROWSER_E2E=1 when browser launch works on the host.
test.skip(!process.env.CELMBOT_BROWSER_E2E, "set CELMBOT_BROWSER_E2E=1 to run headed UI checks");

test("ui loads brand and disclaimer", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "CelmBot" })).toBeVisible({ timeout: 20_000 });
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    await page.getByRole("button", { name: /understand/i }).click();
  }
  await expect(page.getByTestId("stats-strip")).toBeVisible();
  await page.getByRole("button", { name: "Local" }).click();
  await expect(page.getByRole("button", { name: /Add local key/i })).toBeVisible();
});
