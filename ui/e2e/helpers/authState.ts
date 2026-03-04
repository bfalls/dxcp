import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getCachedToken, putCachedToken } from "../../../scripts/govtest/token_cache.ts";
import {
  adminCredentialsFromEnv,
  captureAccessTokenFromSpaCache,
  ensureLoggedInViaUi,
  ensureOwnerDeliveryGroupAccess,
  loadGovtestEnv,
  observerCredentialsFromEnv,
  ownerCredentialsFromEnv,
} from "./auth";

export type AuthRole = "admin" | "owner" | "observer";

const helperDir = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(helperDir, "..", "..");
const authStateDir = join(uiRoot, "playwright", ".auth");
const BROWSER_BOOT_RETRIES = 3;
const BROWSER_BOOT_RETRY_DELAY_MS = 500;
const TOKEN_MIN_TTL_SECONDS = 120;

type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
};

type StorageStateFile = {
  cookies?: Array<{ name?: string; value?: string; domain?: string }>;
  origins?: Array<{
    origin?: string;
    localStorage?: Array<{ name?: string; value?: string }>;
  }>;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function uiBaseUrl(): string {
  return process.env.GOV_DXCP_UI_BASE?.trim() || "http://localhost:5173";
}

function normalizedAuth0Domain(): string {
  return requiredEnv("GOV_AUTH0_DOMAIN").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function tokenExpectation(): { iss: string; aud: string; azp: string } {
  const domain = normalizedAuth0Domain();
  return {
    iss: `https://${domain}/`,
    aud: requiredEnv("GOV_AUTH0_AUDIENCE"),
    azp: requiredEnv("GOV_DXCP_UI_CLIENT_ID"),
  };
}

function roleTokenCacheKey(role: AuthRole): string {
  const creds = roleCredentials(role);
  const domain = normalizedAuth0Domain();
  const audience = requiredEnv("GOV_AUTH0_AUDIENCE");
  const uiClientId = requiredEnv("GOV_DXCP_UI_CLIENT_ID");
  return `user:${role}:${creds.username}:${domain}:${audience}:${uiClientId}`;
}

function b64UrlDecode(input: string): string {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4 || 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(b64UrlDecode(parts[1])) as JwtClaims;
  } catch {
    return null;
  }
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

function tokenMatchesExpectation(token: string, expectation: { iss: string; aud: string; azp: string }): boolean {
  const claims = decodeJwtClaims(token);
  if (!claims) return false;
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000) + TOKEN_MIN_TTL_SECONDS) {
    return false;
  }
  const claimIss = typeof claims.iss === "string" ? normalizeIssuer(claims.iss) : "";
  if (claimIss !== normalizeIssuer(expectation.iss)) return false;
  if (claims.azp !== expectation.azp) return false;
  if (typeof claims.aud === "string") return claims.aud === expectation.aud;
  if (Array.isArray(claims.aud)) return claims.aud.includes(expectation.aud);
  return false;
}

function baseOrigin(url: string): string {
  return new URL(url).origin;
}

function readStorageStateFile(statePath: string): StorageStateFile | null {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as StorageStateFile;
  } catch {
    return null;
  }
}

function tokenFromLocalStorageValue(raw: string): string | null {
  try {
    const tokenData = JSON.parse(raw);
    const candidates = [
      tokenData?.body?.access_token,
      tokenData?.access_token,
      tokenData?.accessToken,
      tokenData?.credentialBody?.access_token,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length >= 20) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function tokenFromStorageState(state: StorageStateFile, preferredOrigin?: string): string | null {
  const origins = Array.isArray(state?.origins) ? state.origins : [];
  const orderedOrigins =
    preferredOrigin && origins.some((origin) => String(origin?.origin || "") === preferredOrigin)
      ? [
          ...origins.filter((origin) => String(origin?.origin || "") === preferredOrigin),
          ...origins.filter((origin) => String(origin?.origin || "") !== preferredOrigin),
        ]
      : origins;

  for (const origin of orderedOrigins) {
    const localStorageItems = Array.isArray(origin?.localStorage) ? origin.localStorage : [];
    for (const entry of localStorageItems) {
      const key = String(entry?.name || "");
      const value = String(entry?.value || "");
      if (!key.includes("@@auth0spajs@@") || !value) continue;
      const token = tokenFromLocalStorageValue(value);
      if (token) return token;
    }
  }
  return null;
}

function hasAuthStateOrigin(state: StorageStateFile, origin: string): boolean {
  const origins = Array.isArray(state?.origins) ? state.origins : [];
  return origins.some((entry) => String(entry?.origin || "") === origin);
}

function authStatePath(role: AuthRole): string {
  return join(authStateDir, `${role}.json`);
}

export function getAuthStatePath(role: AuthRole): string {
  return authStatePath(role);
}

function authStateMaxAgeMs(): number {
  const minutesRaw = process.env.GOV_AUTH_STATE_MAX_AGE_MINUTES?.trim();
  const minutes = Number(minutesRaw || "240");
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 240 * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

function isAuthStateStale(statePath: string): boolean {
  if (!existsSync(statePath)) return true;
  try {
    const stats = statSync(statePath);
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs > authStateMaxAgeMs();
  } catch {
    return true;
  }
}

function roleCredentials(role: AuthRole): { username: string; password: string } {
  if (role === "admin") return adminCredentialsFromEnv();
  if (role === "owner") return ownerCredentialsFromEnv();
  return observerCredentialsFromEnv();
}

async function safeClosePage(page: { close: () => Promise<void> } | null | undefined): Promise<void> {
  if (!page) return;
  try {
    await page.close();
  } catch {
    // Ignore teardown errors when already closed/crashed.
  }
}

async function safeCloseContext(context: { close: () => Promise<void> } | null | undefined): Promise<void> {
  if (!context) return;
  try {
    await context.close();
  } catch {
    // Ignore teardown errors when already closed/crashed.
  }
}

async function safeCloseBrowser(browser: { close: () => Promise<void> } | null | undefined): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Ignore teardown errors when already closed/crashed.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientBrowserBootstrapError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Browser closed") ||
    message.includes("browserType.launch")
  );
}

async function withBrowserPage<T>(
  baseUrl: string,
  storageState: string | undefined,
  action: (args: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BROWSER_BOOT_RETRIES; attempt += 1) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        baseURL: baseUrl,
        ...(storageState ? { storageState } : {}),
      });
      page = await context.newPage();
      return await action({ browser, context, page });
    } catch (err) {
      lastError = err;
      if (attempt >= BROWSER_BOOT_RETRIES || !isTransientBrowserBootstrapError(err)) {
        throw err;
      }
      await delay(BROWSER_BOOT_RETRY_DELAY_MS * attempt);
    } finally {
      await safeClosePage(page);
      await safeCloseContext(context);
      await safeCloseBrowser(browser);
    }
  }
  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}

export async function validateAuthState(role: AuthRole, statePath: string): Promise<boolean> {
  loadGovtestEnv();
  void role;
  if (!existsSync(statePath)) return false;
  const state = readStorageStateFile(statePath);
  if (!state) return false;
  const expectedOrigin = baseOrigin(uiBaseUrl());
  if (!hasAuthStateOrigin(state, expectedOrigin)) {
    return false;
  }
  const token = tokenFromStorageState(state, expectedOrigin);
  if (!token) return false;
  if (!tokenMatchesExpectation(token, tokenExpectation())) {
    return false;
  }
  return true;
}

async function hydrateAuthState(role: AuthRole, statePath: string): Promise<boolean> {
  loadGovtestEnv();
  if (!existsSync(statePath)) return false;
  const baseUrl = uiBaseUrl();
  const creds = roleCredentials(role);

  try {
    return await withBrowserPage(baseUrl, statePath, async ({ context, page }) => {
      await ensureLoggedInViaUi(page, creds.username, creds.password);
      await captureAccessTokenFromSpaCache(page);
      const hasLogout = await page.getByRole("button", { name: "Logout" }).isVisible().catch(() => false);
      if (!hasLogout) return false;
      await context.storageState({ path: statePath });
      return true;
    });
  } catch {
    return false;
  }
}

async function generateAuthState(role: AuthRole, statePath: string): Promise<void> {
  loadGovtestEnv();
  const baseUrl = uiBaseUrl();
  requiredEnv("GOV_AUTH0_DOMAIN");
  requiredEnv("GOV_DXCP_UI_CLIENT_ID");

  const creds = roleCredentials(role);
  mkdirSync(authStateDir, { recursive: true });

  await withBrowserPage(baseUrl, undefined, async ({ context, page }) => {
    await ensureLoggedInViaUi(page, creds.username, creds.password);
    await captureAccessTokenFromSpaCache(page);
    await context.storageState({ path: statePath });
  });
}

export async function ensureAuthState(role: AuthRole, opts?: { force?: boolean }): Promise<string> {
  loadGovtestEnv();
  const statePath = authStatePath(role);
  const shouldForce = opts?.force === true || process.env.CI === "true" || isAuthStateStale(statePath);

  if (!shouldForce && existsSync(statePath)) {
    const valid = await validateAuthState(role, statePath);
    if (valid) return statePath;
    const hydrated = await hydrateAuthState(role, statePath);
    if (hydrated) return statePath;
  }

  await generateAuthState(role, statePath);
  let valid = await validateAuthState(role, statePath);
  if (!valid) {
    const hydrated = await hydrateAuthState(role, statePath);
    if (hydrated) {
      valid = await validateAuthState(role, statePath);
    }
  }
  if (!valid) {
    // Retry once to smooth over transient Auth0/UI initialization races.
    await generateAuthState(role, statePath);
    valid = await validateAuthState(role, statePath);
  }
  if (!valid) {
    throw new Error(`Generated auth state for role=${role} is invalid.`);
  }
  return statePath;
}

function tokenFromStorageStateFile(statePath: string): string | null {
  const state = readStorageStateFile(statePath);
  if (!state) return null;
  const expectedOrigin = (() => {
    try {
      return baseOrigin(uiBaseUrl());
    } catch {
      return undefined;
    }
  })();
  return tokenFromStorageState(state, expectedOrigin);
}

export async function tokenFromAuthState(role: AuthRole): Promise<string> {
  loadGovtestEnv();
  const statePath = authStatePath(role);
  const cacheKey = roleTokenCacheKey(role);
  const expectation = tokenExpectation();
  const cached = getCachedToken(cacheKey, expectation);
  if (cached) {
    console.log(`[authState] Using cached ${role} token`);
    return cached;
  }

  const tokenFromFile = tokenFromStorageStateFile(statePath);
  if (tokenFromFile && tokenMatchesExpectation(tokenFromFile, expectation)) {
    putCachedToken(cacheKey, tokenFromFile);
    console.log(`[authState] Cached ${role} token from storage state`);
    return tokenFromFile;
  }
  const creds = roleCredentials(role);
  const baseUrl = uiBaseUrl();

  return withBrowserPage(baseUrl, statePath, async ({ context, page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45000 });
    const hasLogout = await page
      .getByRole("button", { name: "Logout" })
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasLogout) {
      await ensureLoggedInViaUi(page, creds.username, creds.password);
      await context.storageState({ path: statePath });
    }
    const token = await captureAccessTokenFromSpaCache(page);
    putCachedToken(cacheKey, token);
    console.log(`[authState] Acquired ${role} token via UI and cached`);
    return token;
  });
}

export async function ensureGovBootstrapFromAuthStates(): Promise<void> {
  loadGovtestEnv();
  await ensureAuthState("owner");
  await ensureAuthState("admin");

  const [adminToken, ownerToken] = await Promise.all([
    tokenFromAuthState("admin"),
    tokenFromAuthState("owner"),
  ]);
  await ensureOwnerDeliveryGroupAccess(adminToken, ownerToken);
}
