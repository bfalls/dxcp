import { test, expect } from "@playwright/test";
import {
  adminCredentialsFromEnv,
  ensureOwnerDeliveryGroupAccess,
  loadGovtestEnv,
  loginViaUiAndCaptureToken,
  ownerCredentialsFromEnv,
} from "./helpers/auth";

loadGovtestEnv();

function missingGovEnv(): string[] {
  const missing: string[] = [];
  const requiredAlways = [
    "GOV_DXCP_API_BASE",
    "GOV_AUTH0_DOMAIN",
    "GOV_AUTH0_AUDIENCE",
    "GOV_DXCP_UI_CLIENT_ID",
    "GOV_ADMIN_USERNAME",
    "GOV_ADMIN_PASSWORD",
    "GOV_OWNER_USERNAME",
    "GOV_OWNER_PASSWORD",
  ];
  for (const key of requiredAlways) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }
  return missing;
}

function pickHighestZeroOneVersion(values: string[]): string {
  const candidates = values
    .map((value) => value.trim())
    .map((value) => {
      const match = value.match(/^0\.1\.(\d+)$/);
      if (!match) return null;
      return { value, patch: Number(match[1]) };
    })
    .filter((entry): entry is { value: string; patch: number } => Boolean(entry));

  if (candidates.length === 0) {
    throw new Error("No version matching pattern 0.1.* found in Version dropdown.");
  }

  candidates.sort((a, b) => b.patch - a.patch);
  return candidates[0].value;
}

const missingEnv = missingGovEnv();
if (missingEnv.length > 0) {
  console.log(`[govtest.spec] skipping: missing env vars: ${missingEnv.join(", ")}`);
}

test.describe("govtest thin UI proof", () => {
  test.skip(
    missingEnv.length > 0,
    `Missing required env vars for govtest UI proof: ${missingEnv.join(", ")}`,
  );

  test("owner auth + deploy wiring + provenance fields", async ({ page }) => {
    const ownerCreds = ownerCredentialsFromEnv();
    const adminCreds = adminCredentialsFromEnv();

    // 1) Owner login for owner identity token.
    const ownerToken = await loginViaUiAndCaptureToken(page, ownerCreds.username, ownerCreds.password);
    await page.getByRole("button", { name: "Logout" }).click();

    // 2) Admin login for admin token and idempotent bootstrap setup.
    const adminToken = await loginViaUiAndCaptureToken(page, adminCreds.username, adminCreds.password);
    await ensureOwnerDeliveryGroupAccess(adminToken, ownerToken);
    await page.getByRole("button", { name: "Logout" }).click();

    // 3) Final owner login for UI assertions.
    await loginViaUiAndCaptureToken(page, ownerCreds.username, ownerCreds.password);

    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
    await expect(page.getByTestId("nav-deploy")).toBeVisible();

    await page.getByTestId("nav-deploy").click();
    await expect(page).toHaveURL(/\/deploy/);

    // Deterministic guard: provenance workflow requires at least one configured environment.
    const environmentSelector = page.getByTestId("environment-selector");
    await expect(environmentSelector).toBeVisible({ timeout: 20000 });
    await expect(environmentSelector.locator("option")).toHaveCount(1, { timeout: 20000 });
    await expect(environmentSelector).toHaveValue("sandbox");

    const serviceSelect = page.getByTestId("deploy-service-select");
    await expect(serviceSelect).toBeVisible();
    await expect(serviceSelect.locator("option[value='demo-service']")).toHaveCount(1);
    await serviceSelect.selectOption("demo-service");
    await expect(serviceSelect).toHaveValue("demo-service");

    // Deploy page refreshes versions asynchronously; wait until the native options settle.
    await expect(page.getByText("Loading versions...")).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByText("Refreshing versions...")).toHaveCount(0, { timeout: 20000 });

    const versionSelect = page.getByTestId("deploy-version-select");
    const versionValues = await versionSelect
      .locator("option")
      .evaluateAll((options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .filter((value) => Boolean(value) && value !== "__select__" && value !== "__custom__"),
      );
    const selectedVersion = pickHighestZeroOneVersion(versionValues);
    console.log(`[govtest.spec] selected highest 0.1.* version=${selectedVersion}`);
    await versionSelect.selectOption(selectedVersion, { force: true });
    await expect(versionSelect).toHaveValue(selectedVersion);

    await expect(page.getByText("Build Provenance", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading provenance...")).toHaveCount(0, { timeout: 20000 });
    const unavailable = page.getByText("Build provenance unavailable for this version.");
    const provenanceBlock = page.locator(".provenance-block");

    await page.waitForFunction(() => {
      const unavailableNode = Array.from(document.querySelectorAll("*")).find(
        (el) => el.textContent?.trim() === "Build provenance unavailable for this version.",
      );
      const hasPublisher = Array.from(document.querySelectorAll(".provenance-block dt")).some(
        (el) => el.textContent?.trim() === "Publisher",
      );
      const unavailableVisible = Boolean(unavailableNode && (unavailableNode as HTMLElement).offsetParent !== null);
      return unavailableVisible || hasPublisher;
    }, { timeout: 20000 });

    if ((await unavailable.count()) > 0 && (await unavailable.first().isVisible())) {
      throw new Error(`Build provenance unavailable for selected version ${selectedVersion}`);
    }

    await expect(provenanceBlock).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("Publisher", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("Git SHA", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("Registered", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("Artifact", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("CI Provider", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(provenanceBlock.getByText("Run ID", { exact: true })).toBeVisible({ timeout: 20000 });
  });
});
