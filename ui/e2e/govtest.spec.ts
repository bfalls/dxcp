import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureAccessTokenFromSpaCache, loadGovtestEnv } from "./helpers/auth";
import { getAuthStatePath } from "./helpers/authState";

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
    "GOV_OBSERVER_USERNAME",
    "GOV_OBSERVER_PASSWORD",
  ];
  for (const key of requiredAlways) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }
  return missing;
}

async function hasBuildProvenance(
  apiBase: string,
  ownerToken: string,
  service: string,
  version: string,
): Promise<boolean> {
  const response = await fetch(
    `${apiBase}/v1/builds?service=${encodeURIComponent(service)}&version=${encodeURIComponent(version)}`,
    { method: "GET", headers: { Authorization: `Bearer ${ownerToken}` } },
  );
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  if (!body || body.code) return false;
  return typeof body.version === "string" && body.version.trim().length > 0;
}

function resolveRunVersionFromLastRunArtifact(): string {
  const candidates = [
    join(process.cwd(), ".govtest.last-run.json"),
    join(process.cwd(), "..", ".govtest.last-run.json"),
  ];
  const artifactPath = candidates.find((p) => existsSync(p));
  if (!artifactPath) return "";
  try {
    const body = JSON.parse(readFileSync(artifactPath, "utf8"));
    const value = typeof body?.runVersion === "string" ? body.runVersion.trim() : "";
    return value;
  } catch {
    return "";
  }
}

const missingEnv = missingGovEnv();
if (missingEnv.length > 0) {
  console.log(`[govtest.spec] skipping: missing env vars: ${missingEnv.join(", ")}`);
}

test.describe("govtest thin UI proof", () => {
  test.setTimeout(180000);

  let ownerStatePath = "";
  const uiBase = process.env.GOV_DXCP_UI_BASE?.trim() || "http://localhost:5173";

  test.skip(
    missingEnv.length > 0,
    `Missing required env vars for govtest UI proof: ${missingEnv.join(", ")}`,
  );

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180000);
    void browser;
    ownerStatePath = getAuthStatePath("owner");
  });

  test("owner auth + deploy wiring + provenance fields", async ({ browser }) => {
    const ownerContext = await browser.newContext({ storageState: ownerStatePath, baseURL: uiBase });
    const page = await ownerContext.newPage();
    try {
      await page.goto("/");

      await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
      await expect(page.getByTestId("nav-deploy")).toBeVisible();
      const ownerToken = await captureAccessTokenFromSpaCache(page);
      const apiBase = (process.env.GOV_DXCP_API_BASE || "").trim().replace(/\/$/, "");
      if (!apiBase) {
        throw new Error("GOV_DXCP_API_BASE is required for govtest UI proof.");
      }

      await page.getByTestId("nav-deploy").click();
      await expect(page).toHaveURL(/\/deploy/);

      // Deterministic guard: provenance workflow requires at least one configured environment.
      const environmentSelector = page.getByTestId("environment-selector");
      await expect(environmentSelector).toBeVisible({ timeout: 20000 });
      await expect(environmentSelector.locator("option")).toHaveCount(1, { timeout: 20000 });
      await expect(environmentSelector).toHaveValue("sandbox");

      const serviceSelect = page.getByTestId("deploy-service-select");
      await expect(serviceSelect).toBeVisible();
      const configuredService = (process.env.GOV_SERVICE || "").trim() || "demo-service";
      const refreshDataButton = page.getByRole("button", { name: /refresh data/i }).first();
      const refreshBanner = page.getByText(/Refresh required\./i).first();
      let serviceReady = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const serviceOptions = await serviceSelect
          .locator("option")
          .evaluateAll((options) =>
            options
              .map((option) => (option as HTMLOptionElement).value)
              .filter((value) => Boolean(value) && value !== "__none__"),
          );
        if (serviceOptions.includes(configuredService)) {
          await serviceSelect.selectOption(configuredService);
          await expect(serviceSelect).toHaveValue(configuredService);
          serviceReady = true;
          break;
        }
        if (serviceOptions.length > 0) {
          await serviceSelect.selectOption(serviceOptions[0]);
          await expect(serviceSelect).toHaveValue(serviceOptions[0]);
          serviceReady = true;
          break;
        }
        if ((await refreshBanner.isVisible().catch(() => false)) && (await refreshDataButton.isVisible().catch(() => false))) {
          await refreshDataButton.click();
          await page.waitForTimeout(1200);
          continue;
        }
        await page.waitForTimeout(1200);
      }
      if (!serviceReady) {
        const currentValue = await serviceSelect.inputValue().catch(() => "<unavailable>");
        throw new Error(
          `No deployable service available after refresh attempts. configuredService=${configuredService} currentValue=${currentValue}`,
        );
      }

      // Cross-browser determinism: ensure a strategy is explicitly selected.
      const strategyPrompt = page.getByText("Select a strategy to continue.");
      if ((await strategyPrompt.count()) > 0 && (await strategyPrompt.first().isVisible().catch(() => false))) {
        const preferredStrategy = page.getByRole("radio", { name: /Default Deploy v2/i }).first();
        if (await preferredStrategy.isVisible().catch(() => false)) {
          await preferredStrategy.click();
        } else {
          await page.getByRole("radio").first().click();
        }
        await expect(strategyPrompt).toHaveCount(0, { timeout: 10000 });
      }

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
      const artifactRunVersion = resolveRunVersionFromLastRunArtifact();
      const strictConformance =
        ((process.env.GOV_CONFORMANCE_PROFILE || "").trim().toLowerCase() || "diagnostic") === "strict";
      const sortedVersionValues = [...versionValues].sort((a, b) => {
        const aMatch = a.match(/^0\.1\.(\d+)$/);
        const bMatch = b.match(/^0\.1\.(\d+)$/);
        const aPatch = aMatch ? Number(aMatch[1]) : -1;
        const bPatch = bMatch ? Number(bMatch[1]) : -1;
        return bPatch - aPatch;
      });

      let selectedVersion = "";
      if (artifactRunVersion) {
        if (!versionValues.includes(artifactRunVersion) && strictConformance) {
          throw new Error(
            `Strict conformance requires runVersion=${artifactRunVersion} from .govtest.last-run.json, but it is not available in Deploy version list.`,
          );
        }
        if (versionValues.includes(artifactRunVersion)) {
          const configuredHasProvenance = await hasBuildProvenance(
            apiBase,
            ownerToken,
            configuredService,
            artifactRunVersion,
          );
          if (configuredHasProvenance) {
            selectedVersion = artifactRunVersion;
          } else if (strictConformance) {
            throw new Error(
              `Strict conformance requires runVersion=${artifactRunVersion} from .govtest.last-run.json, but it has no build provenance record.`,
            );
          }
        }
      }
      if (!selectedVersion) {
        for (const candidate of sortedVersionValues) {
          if (await hasBuildProvenance(apiBase, ownerToken, configuredService, candidate)) {
            selectedVersion = candidate;
            break;
          }
        }
        if (!selectedVersion) {
          throw new Error(
            `No deployable version with build provenance found for service=${configuredService}.`,
          );
        }
      }

      let selected = false;
      const selectByValue = async (value: string): Promise<boolean> => {
        try {
          await versionSelect.selectOption(value);
          await expect(versionSelect).toHaveValue(value, { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      };
      selected = await selectByValue(selectedVersion);
      if (!selected) {
        throw new Error(`Could not select deploy version. target=${selectedVersion}`);
      }
      const useStrictRunIdChecks = strictConformance && artifactRunVersion.length > 0 && selectedVersion === artifactRunVersion;
      console.log(`[govtest.spec] selected version=${selectedVersion} strict=${useStrictRunIdChecks ? "true" : "false"}`);
      const effectiveVersionValue = (await versionSelect.inputValue().catch(() => "")).trim();
      if (effectiveVersionValue !== selectedVersion) {
        throw new Error(
          `Version selector did not settle to selected value. expected=${selectedVersion} actual=${effectiveVersionValue || "<empty>"}`,
        );
      }

      const provenanceHeading = page.getByText("Build Provenance", { exact: true });
      const provenanceHeadingVisible = await provenanceHeading.isVisible().catch(() => false);
      if (!provenanceHeadingVisible) {
        const policyResp = await fetch(`${apiBase}/v1/ui/policy/ui-exposure`, {
          method: "GET",
          headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const policyBody = await policyResp.json().catch(() => null);
        if (!policyResp.ok) {
          throw new Error(`Could not verify UI exposure policy (${policyResp.status}): ${JSON.stringify(policyBody)}`);
        }
        const policyDisplay =
          policyBody?.policy?.artifactRef?.display === true || policyBody?.artifactRef?.display === true;
        if (policyDisplay) {
          throw new Error("Build Provenance section is hidden while ui-exposure policy enables artifactRef.display=true.");
        }
        console.log("[govtest.spec] Build Provenance is hidden by UI exposure policy; skipping provenance field assertions.");
        return;
      }

      await expect(provenanceHeading).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("Loading provenance...")).toHaveCount(0, { timeout: 20000 });
      const unavailable = page.getByText("Build provenance unavailable for this version.");
      const provenanceBlock = page.locator(".provenance-block");
      await expect
        .poll(async () => {
          const unavailableVisible =
            (await unavailable.count()) > 0 && (await unavailable.first().isVisible().catch(() => false));
          const publisherVisible = await provenanceBlock
            .getByText("Publisher", { exact: true })
            .first()
            .isVisible()
            .catch(() => false);
          return unavailableVisible || publisherVisible;
        }, { timeout: 20000 })
        .toBeTruthy();

      if ((await unavailable.count()) > 0 && (await unavailable.first().isVisible())) {
        throw new Error(`Build provenance unavailable for selected version ${selectedVersion}`);
      }

      await expect(provenanceBlock).toBeVisible({ timeout: 20000 });
      await expect(provenanceBlock.getByText("Publisher", { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(provenanceBlock.getByText("Git SHA", { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(provenanceBlock.getByText("Registered", { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(provenanceBlock.getByText("Artifact", { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(provenanceBlock.getByText("CI Provider", { exact: true })).toBeVisible({ timeout: 20000 });
      const runIdLabel = provenanceBlock.getByText("Run ID", { exact: true }).first();
      await expect(runIdLabel).toBeVisible({ timeout: 20000 });
      if (useStrictRunIdChecks) {
        const runIdValue = runIdLabel.locator("xpath=following::dd[1]").first();
        await expect(runIdValue).toBeVisible({ timeout: 20000 });
        await expect(runIdValue).not.toHaveText(/^\s*-\s*$/);
        await expect(runIdValue).not.toHaveText(/^\s*$/);
      }
    } finally {
      await ownerContext.close().catch(() => undefined);
    }
  });
});
