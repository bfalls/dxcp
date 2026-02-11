import { test, expect } from "@playwright/test";

test("smoke: DXCP loads", async ({ page }) => {
  await page.goto("/");

  // App loads (keep this)
  await expect(page).toHaveTitle(/DXCP/i);

  // Assert a stable, always-present nav/tab
  await expect(page.getByTestId("nav-services")).toBeVisible();
  await expect(page.getByTestId("nav-deploy")).toBeVisible();
});

test("layout: nav aligns to container at common widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const headerContainer = page.locator(".header .layout-container");
  const nav = page.locator("nav.nav");
  const bodyContainer = page.locator(".page-body.layout-container");

  const headerBoxWide = await headerContainer.boundingBox();
  const navBoxWide = await nav.boundingBox();
  const bodyBoxWide = await bodyContainer.boundingBox();
  const headerPaddingLeftWide = await headerContainer.evaluate((el) => {
    const value = window.getComputedStyle(el).paddingLeft;
    return Number.parseFloat(value || "0");
  });

  expect(headerBoxWide).toBeTruthy();
  expect(navBoxWide).toBeTruthy();
  expect(bodyBoxWide).toBeTruthy();

  expect(Math.abs(navBoxWide!.x - (headerBoxWide!.x + headerPaddingLeftWide))).toBeLessThan(2);
  expect(Math.abs(bodyBoxWide!.x - headerBoxWide!.x)).toBeLessThan(2);

  await page.setViewportSize({ width: 1024, height: 900 });
  const headerBoxNarrow = await headerContainer.boundingBox();
  const navBoxNarrow = await nav.boundingBox();
  const bodyBoxNarrow = await bodyContainer.boundingBox();
  const headerPaddingLeftNarrow = await headerContainer.evaluate((el) => {
    const value = window.getComputedStyle(el).paddingLeft;
    return Number.parseFloat(value || "0");
  });

  expect(headerBoxNarrow).toBeTruthy();
  expect(navBoxNarrow).toBeTruthy();
  expect(bodyBoxNarrow).toBeTruthy();

  expect(Math.abs(navBoxNarrow!.x - (headerBoxNarrow!.x + headerPaddingLeftNarrow))).toBeLessThan(2);
  expect(Math.abs(bodyBoxNarrow!.x - headerBoxNarrow!.x)).toBeLessThan(2);
});

test("smoke: navigation between primary routes", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("nav-services").click();
  await expect(page).toHaveURL(/\/services/);

  await page.getByTestId("nav-deploy").click();
  await expect(page).toHaveURL(/\/deploy/);

  await page.getByRole("link", { name: "Deployments" }).click();
  await expect(page).toHaveURL(/\/deployments/);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
});
