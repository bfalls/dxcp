import { test, expect } from "@playwright/test";

test("smoke: DXCP loads", async ({ page }) => {
  await page.goto("/");

  // App loads (keep this)
  await expect(page).toHaveTitle(/DXCP/i);

  // Assert a stable, always-present nav/tab
  await expect(page.getByTestId("nav-services")).toBeVisible();
  await expect(page.getByTestId("nav-deploy")).toBeVisible();
});
