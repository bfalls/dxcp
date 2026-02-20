import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { requiredEnv } from "./common.ts";
import {
  adminCredentialsFromEnv,
  captureAccessTokenFromSpaCache,
  ensureLoggedInViaUi,
  loadGovtestEnv,
  observerCredentialsFromEnv,
  ownerCredentialsFromEnv,
} from "../../ui/e2e/helpers/auth.ts";

type RoleName = "admin" | "owner" | "observer";

function getRoleCredentials(role: RoleName): { username: string; password: string } {
  if (role === "admin") return adminCredentialsFromEnv();
  if (role === "owner") return ownerCredentialsFromEnv();
  return observerCredentialsFromEnv();
}

type ChromiumApi = { launch: (opts: { headless: boolean }) => Promise<any> };

async function importPlaywright(): Promise<{ chromium: ChromiumApi }> {
  try {
    const requireFromUi = createRequire(join(process.cwd(), "ui", "package.json"));
    const modulePath = requireFromUi.resolve("@playwright/test");
    const moduleUrl = pathToFileURL(modulePath).href;
    const imported = (await import(moduleUrl)) as { chromium?: ChromiumApi; default?: { chromium?: ChromiumApi } };
    const chromium = imported.chromium ?? imported.default?.chromium;
    if (!chromium?.launch) {
      throw new Error("Resolved @playwright/test did not expose chromium.launch");
    }
    return { chromium };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Playwright is required for govtest user token acquisition. Install UI dependencies first (cd ui && npm install). Root cause: ${detail}`,
    );
  }
}

export async function getUserAccessTokenViaPlaywright(role: RoleName): Promise<string> {
  loadGovtestEnv();
  const baseURL = requiredEnv("GOV_DXCP_UI_BASE");
  requiredEnv("GOV_AUTH0_DOMAIN");
  requiredEnv("GOV_DXCP_UI_CLIENT_ID");

  const { chromium } = await importPlaywright();
  const creds = getRoleCredentials(role);
  const browser = await launchBrowser(chromium);
  const context = await browser.newContext({ baseURL });
  const page = (await context.newPage()) as Page;

  try {
    console.log(`[INFO] Acquiring ${role} user token via headless SPA login`);
    await ensureLoggedInViaUi(page, creds.username, creds.password);
    const token = await captureAccessTokenFromSpaCache(page);
    if (!token) {
      throw new Error(`Captured empty token for role=${role}`);
    }
    console.log(`[INFO] Acquired ${role} user token`);
    return token;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function launchBrowser(chromium: ChromiumApi): Promise<any> {
  const attempts: Array<{ headless: boolean; channel?: string }> = [
    { headless: true },
    { headless: true, channel: "msedge" },
    { headless: true, channel: "chrome" },
  ];

  let lastError: unknown;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts as { headless: boolean });
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      console.log(
        `[INFO] Playwright launch failed for channel=${opts.channel ?? "bundled"}; retrying if alternatives remain (${detail})`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
