import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  adminCredentialsFromEnv,
  ensureLoggedInViaUi,
  loadGovtestEnv,
  observerCredentialsFromEnv,
  ownerCredentialsFromEnv,
} from "./auth";

export type AuthRole = "admin" | "owner" | "observer";

const helperDir = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(helperDir, "..", "..");
const authStateDir = join(uiRoot, "playwright", ".auth");

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function uiBaseUrl(): string {
  return process.env.GOV_DXCP_UI_BASE?.trim() || "http://localhost:5173";
}

function authStatePath(role: AuthRole): string {
  return join(authStateDir, `${role}.json`);
}

function roleCredentials(role: AuthRole): { username: string; password: string } {
  if (role === "admin") return adminCredentialsFromEnv();
  if (role === "owner") return ownerCredentialsFromEnv();
  return observerCredentialsFromEnv();
}

function isRedirectedToAuth0(url: string): boolean {
  const host = requiredEnv("GOV_AUTH0_DOMAIN").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return url.includes(host);
}

export async function validateAuthState(role: AuthRole, statePath: string): Promise<boolean> {
  loadGovtestEnv();
  void role;
  if (!existsSync(statePath)) return false;
  const baseUrl = uiBaseUrl();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl, storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => {
      const navDeploy = document.querySelector("[data-testid='nav-deploy']");
      const buttons = Array.from(document.querySelectorAll("button"));
      const hasLogout = buttons.some((b) => b.textContent?.trim() === "Logout");
      const hasLogin = buttons.some((b) => b.textContent?.trim() === "Login");
      return Boolean(navDeploy || hasLogout || hasLogin);
    }, { timeout: 20000 });

    if (isRedirectedToAuth0(page.url())) return false;
    const hasNavDeploy = (await page.getByTestId("nav-deploy").count()) > 0;
    const hasLogout = (await page.getByRole("button", { name: "Logout" }).count()) > 0;
    const hasLogin = (await page.getByRole("button", { name: "Login" }).count()) > 0;
    if (hasNavDeploy || hasLogout) return true;
    return !hasLogin;
  } catch {
    return false;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function generateAuthState(role: AuthRole, statePath: string): Promise<void> {
  loadGovtestEnv();
  const baseUrl = uiBaseUrl();
  requiredEnv("GOV_AUTH0_DOMAIN");
  requiredEnv("GOV_DXCP_UI_CLIENT_ID");

  const creds = roleCredentials(role);
  mkdirSync(authStateDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await ensureLoggedInViaUi(page, creds.username, creds.password);
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function ensureAuthState(role: AuthRole, opts?: { force?: boolean }): Promise<string> {
  loadGovtestEnv();
  const statePath = authStatePath(role);
  const shouldForce = opts?.force === true || process.env.CI === "true";

  if (!shouldForce && existsSync(statePath)) {
    const isValid = await validateAuthState(role, statePath);
    if (isValid) return statePath;
  }

  await generateAuthState(role, statePath);
  const valid = await validateAuthState(role, statePath);
  if (!valid) {
    throw new Error(`Generated auth state for role=${role} is invalid.`);
  }
  return statePath;
}
