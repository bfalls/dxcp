import { test, expect, type Page } from "@playwright/test";
import { loadGovtestEnv } from "./helpers/auth";
import { ensureAuthState, ensureGovBootstrapFromAuthStates, getAuthStatePath, tokenFromAuthState } from "./helpers/authState";

loadGovtestEnv();

let govtestSkipReason: string | null = process.env.GOV_BOOTSTRAP_SKIP_REASON?.trim() || null;

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

function serviceName(): string {
  return (process.env.GOV_SERVICE || "demo-service").trim();
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function apiBase(): string {
  return (process.env.GOV_DXCP_API_BASE || "").trim().replace(/\/$/, "");
}

async function apiJson(path: string, token: string): Promise<any> {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function selectableOptionValues(page: Page, selector: string): Promise<string[]> {
  const control = page.locator(selector);
  const options = await control.locator("option").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        value: (node as HTMLOptionElement).value,
        disabled: (node as HTMLOptionElement).disabled,
      }))
      .filter((node) => node.value && node.disabled !== true),
  );
  return options.map((option) => option.value);
}

async function ensureSelectedValue(page: Page, selector: string): Promise<string | null> {
  const control = page.locator(selector);
  let value = await control.inputValue();
  if (value) return value;
  const options = await selectableOptionValues(page, selector);
  if (options.length === 0) return null;
  await control.selectOption(options[0]);
  value = await control.inputValue();
  return value || null;
}

async function waitForOwnerDeployOutcome(page: Page): Promise<"enabled" | "blocked" | "permission-limited" | "readiness-error"> {
  const deployButton = page.getByRole("button", { name: "Deploy", exact: true });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await deployButton.isEnabled().catch(() => false)) return "enabled";
    if (await page.getByText("Deploy blocked", { exact: true }).first().isVisible().catch(() => false)) return "blocked";
    if (await page.getByText("Permission-limited deploy", { exact: true }).first().isVisible().catch(() => false)) {
      return "permission-limited";
    }
    if (await page.getByText("Readiness could not be refreshed", { exact: true }).first().isVisible().catch(() => false)) {
      return "readiness-error";
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for a meaningful owner deploy outcome.");
}

async function openAuthenticatedPage(browser: Parameters<typeof test.beforeAll>[0]["browser"], role: "owner" | "observer", uiBase: string) {
  const context = await browser.newContext({ storageState: getAuthStatePath(role), baseURL: uiBase });
  const page = await context.newPage();
  return { context, page };
}

const missingEnv = missingGovEnv();
if (missingEnv.length > 0) {
  console.log(`[govtest.spec] skipping: missing env vars: ${missingEnv.join(", ")}`);
  govtestSkipReason = `Missing required env vars for govtest UI proof: ${missingEnv.join(", ")}`;
}

test.describe("govtest thin UI proof", () => {
  test.setTimeout(180000);

  const uiBase = process.env.GOV_DXCP_UI_BASE?.trim() || "http://localhost:5173";
  const configuredService = serviceName();

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180000);
    void browser;
    if (govtestSkipReason) return;
    try {
      await Promise.all([ensureGovBootstrapFromAuthStates(), ensureAuthState("observer")]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      govtestSkipReason = `Governance bootstrap unavailable: ${message}`;
      console.log(`[govtest.spec] skipping governed route proof: ${message}`);
    }
  });

  test("owner coverage uses the current /new/* governed routes", async ({ browser }) => {
    test.skip(Boolean(govtestSkipReason), govtestSkipReason || "");
    const ownerToken = await tokenFromAuthState("owner");
    const visibleDeployments = await apiJson(`/v1/deployments?service=${encodeURIComponent(configuredService)}`, ownerToken);
    const { context, page } = await openAuthenticatedPage(browser, "owner", uiBase);
    try {
      await page.goto("/new/applications");
      await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
      await expect(page).toHaveURL(new RegExp("/new/applications$"));
      await expect(page.getByRole("heading", { name: "Applications", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("table", { name: "Application collection" })).toBeVisible();

      await page.goto(`/new/applications/${encodeURIComponent(configuredService)}`);
      await expect(page).toHaveURL(new RegExp(`/new/applications/${escapedRegExp(encodeURIComponent(configuredService))}$`));
      await expect(page.getByRole("heading", { name: "Application", exact: true })).toBeVisible();
      await expect(page.getByText(configuredService, { exact: true })).toBeVisible();

      await page.goto(`/new/applications/${encodeURIComponent(configuredService)}/deploy`);
      await expect(page).toHaveURL(
        new RegExp(`/new/applications/${escapedRegExp(encodeURIComponent(configuredService))}/deploy$`),
      );
      await expect(page.getByRole("heading", { name: "Deploy Application", exact: true })).toBeVisible();
      const deployApplicationInput = page.locator("#new-deploy-application");
      await expect(deployApplicationInput).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("Deploy workflow could not be loaded")).toHaveCount(0);
      await expect(page.getByText("Deploy workflow is not available on this route")).toHaveCount(0);
      await expect(deployApplicationInput).toHaveValue(configuredService);
      const environmentSelect = page.locator("#new-deploy-environment");
      const strategySelect = page.locator("#new-deploy-strategy");
      const versionSelect = page.locator("#new-deploy-version");
      const changeSummary = page.locator("#new-deploy-change-summary");
      const deployButton = page.getByRole("button", { name: "Deploy", exact: true });
      await expect(environmentSelect).toBeEnabled();
      await expect(strategySelect).toBeEnabled();
      await expect(versionSelect).toBeEnabled();
      await expect(changeSummary).toBeEditable();
      await expect(deployButton).toBeVisible();
      await expect(page.getByRole("heading", { name: "Readiness review", exact: true })).toBeVisible();

      await ensureSelectedValue(page, "#new-deploy-environment");
      const selectableStrategies = await selectableOptionValues(page, "#new-deploy-strategy");
      if (selectableStrategies.length === 0) {
        await expect(page.getByText("Deploy blocked", { exact: true }).first()).toBeVisible();
        await expect(deployButton).toBeDisabled();
        await expect(
          page.getByText("DXCP did not return a current Deployment Strategy that can be used for a new deploy on this route. Review Deployment Group policy before you deploy again."),
        ).toBeVisible();
      } else {
        await ensureSelectedValue(page, "#new-deploy-strategy");
        const selectedVersion = await ensureSelectedValue(page, "#new-deploy-version");
        if (!selectedVersion) {
          await expect(deployButton).toBeDisabled();
          await expect(page.getByText("No registered version is currently available.")).toBeVisible();
        } else {
          await changeSummary.fill("Governance owner UI proof deploy intent.");

          const ownerOutcome = await waitForOwnerDeployOutcome(page);
          if (ownerOutcome === "enabled") {
            await expect(page.getByText("Ready to deploy", { exact: true })).toBeVisible();
            await expect(page.getByText("DXCP has confirmed that guardrails allow this deploy now.")).toBeVisible();
            await expect(deployButton).toBeEnabled();
          } else if (ownerOutcome === "blocked") {
            await expect(page.getByText("Deploy blocked", { exact: true }).first()).toBeVisible();
            await expect(deployButton).toBeDisabled();
            await expect(page.getByText(/DXCP already has|daily deploy quota|selected Deployment Strategy|Unable to validate deployment/i).first()).toBeVisible();
          } else if (ownerOutcome === "readiness-error") {
            await expect(page.getByText("Readiness could not be refreshed", { exact: true })).toBeVisible();
            await expect(deployButton).toBeDisabled();
            await expect(page.getByText("DXCP could not validate this deploy intent right now.")).toBeVisible();
          } else {
            await expect(page.getByText("Permission-limited deploy", { exact: true })).toBeVisible();
            await expect(deployButton).toBeDisabled();
            await expect(page.getByText(/does not include Deploy|does not allow deploys/i).first()).toBeVisible();
          }
        }
      }

      await page.goto(`/new/deployments?service=${encodeURIComponent(configuredService)}`);
      await expect(page).toHaveURL(new RegExp(`/new/deployments\\?service=${escapedRegExp(encodeURIComponent(configuredService))}`));
      await expect(page.getByRole("heading", { name: "Deployments", exact: true })).toBeVisible();
      await expect(page.getByText("Loading deployment history")).toHaveCount(0, { timeout: 20000 });
      const openDeploymentLink = page.getByRole("link", { name: "Open", exact: true }).first();
      if (Array.isArray(visibleDeployments) && visibleDeployments.length > 0) {
        await expect(openDeploymentLink).toBeVisible();
        const deploymentHref = await openDeploymentLink.getAttribute("href");
        expect(deploymentHref).toMatch(/^\/new\/deployments\/[^/]+$/);
        await openDeploymentLink.click();
        await expect(page).toHaveURL(/\/new\/deployments\/[^/]+$/);
        await expect(page.getByRole("heading", { name: "Deployment", exact: true })).toBeVisible();
        await expect(page.locator(".new-page-object-identity")).toContainText("Deployment ");
        await expect(page.getByRole("heading", { name: "Deployment timeline", exact: true })).toBeVisible();
      } else {
        const emptyTitle = page.getByText("No deployments recorded yet", { exact: true });
        const noResultsTitle = page.getByText("No deployments match this scope", { exact: true });
        const renderedEmptyState = (await emptyTitle.isVisible().catch(() => false)) || (await noResultsTitle.isVisible().catch(() => false));
        expect(renderedEmptyState).toBeTruthy();
      }

      await page.goto("/new/insights");
      await expect(page).toHaveURL(/\/new\/insights$/);
      await expect(page.getByRole("heading", { name: "Insights", exact: true })).toBeVisible();
      await expect(page.getByLabel("Time window")).toBeVisible();
      await expect(page.getByLabel("Application")).toBeVisible();
      await expect(page.getByLabel("Deployment Group")).toBeVisible();
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("observer direct access to the current /new deploy route stays non-mutating and truthful", async ({ browser }) => {
    test.skip(Boolean(govtestSkipReason), govtestSkipReason || "");
    const { context, page } = await openAuthenticatedPage(browser, "observer", uiBase);
    try {
      const attemptedMutationRequests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/v1\/deployments(?:\/validate)?$/.test(request.url())) {
          attemptedMutationRequests.push(request.url());
        }
      });
      await page.goto(`/new/applications/${encodeURIComponent(configuredService)}/deploy`);
      await expect(page).toHaveURL(
        new RegExp(`/new/applications/${escapedRegExp(encodeURIComponent(configuredService))}/deploy$`),
      );
      await expect(page.getByRole("heading", { name: "Deploy Application", exact: true })).toBeVisible();
      await expect(page.getByText("Read-only workflow").first()).toBeVisible();
      await expect(page.locator(".new-page-read-only-value")).toHaveText("Read-only");
      await expect(page.getByRole("button", { name: /warning issue: read-only/i })).toBeVisible();
      await expect(page.getByText("Loading deploy intent")).toHaveCount(0, { timeout: 20000 });
      await expect(page.getByText("Deploy workflow could not be loaded")).toHaveCount(0);
      await expect(page.getByText("Deploy workflow is not available on this route")).toHaveCount(0);
      await expect(page.locator("#new-deploy-change-summary")).toBeVisible({ timeout: 20000 });
      await expect(page.locator("#new-deploy-environment")).toBeDisabled();
      await expect(page.locator("#new-deploy-strategy")).toBeDisabled();
      await expect(page.locator("#new-deploy-version")).toBeDisabled();
      const changeSummary = page.locator("#new-deploy-change-summary");
      await expect(changeSummary).toHaveJSProperty("readOnly", true);
      const originalValue = await changeSummary.inputValue();
      await changeSummary.click();
      await page.keyboard.type("observer cannot mutate");
      await expect(changeSummary).toHaveValue(originalValue);
      await page.waitForTimeout(500);
      expect(attemptedMutationRequests).toHaveLength(0);
      await expect(page.getByRole("button", { name: "Deploy", exact: true })).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("non-admin direct access to /new/admin resolves to blocked access", async ({ browser }) => {
    test.skip(Boolean(govtestSkipReason), govtestSkipReason || "");
    const { context, page } = await openAuthenticatedPage(browser, "owner", uiBase);
    try {
      await page.goto("/new/admin");
      await expect(page).toHaveURL(/\/new\/admin$/);
      await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Admin access required", exact: true })).toBeVisible();
      await expect(page.getByText(/This area is limited to platform administration\./).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Open Applications" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Open Deployments" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Open Insights" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("legacy routes remain only as explicit coexistence targets from the current /new experience", async ({ browser }) => {
    test.skip(Boolean(govtestSkipReason), govtestSkipReason || "");
    const { context, page } = await openAuthenticatedPage(browser, "owner", uiBase);
    try {
      await page.goto(`/new/applications/${encodeURIComponent(configuredService)}`);
      await expect(page.getByRole("link", { name: "Return to Legacy" })).toHaveAttribute(
        "href",
        `/services/${encodeURIComponent(configuredService)}`,
      );

      await page.goto(`/new/applications/${encodeURIComponent(configuredService)}/deploy`);
      await expect(page.getByRole("link", { name: "Return to Legacy" })).toHaveAttribute(
        "href",
        `/deploy?service=${encodeURIComponent(configuredService)}`,
      );

      await page.goto("/new/deployments");
      await expect(page.getByRole("link", { name: "Return to Legacy" })).toHaveAttribute("href", "/deployments");
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
