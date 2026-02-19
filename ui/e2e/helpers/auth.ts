import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let loadedGovtestEnv = false;

export function loadGovtestEnv(): void {
  if (loadedGovtestEnv) return;
  loadedGovtestEnv = true;

  const candidates = [join(process.cwd(), ".env.govtest"), join(process.cwd(), "..", ".env.govtest")];
  const envPath = candidates.find((p) => existsSync(p));
  if (!envPath) return;

  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function visibleFirst(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return selector;
    }
  }
  return null;
}

async function completeAuth0Login(page: Page, username: string, password: string): Promise<void> {
  // Username/email step (identifier-first or classic form).
  const userSelector =
    (await visibleFirst(page, ["input[name='username']", "input#username", "input[name='email']", "input[type='email']"])) ||
    "input[name='username']";
  await page.locator(userSelector).first().fill(username);

  // Continue/next where required.
  const continueButton = page.getByRole("button", { name: /continue|next/i }).first();
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
  }

  // Password step.
  const passwordInput = page.locator("input[name='password'], input#password, input[type='password']").first();
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.fill(password);

  // Submit/login button.
  const submit = page.getByRole("button", { name: /log in|login|sign in|continue/i }).first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await page.locator("button[type='submit']").first().click();
  }

  // Return to app.
  await page.getByRole("button", { name: "Logout" }).waitFor({ state: "visible", timeout: 60000 });
}

export async function loginViaUiAndCaptureToken(page: Page, username: string, password: string): Promise<string> {
  await page.goto("/");
  const loginButton = page.getByRole("button", { name: "Login" });
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click();
    await completeAuth0Login(page, username, password);
  } else {
    await page.getByRole("button", { name: "Logout" }).waitFor({ state: "visible", timeout: 15000 });
  }

  const token = await page.evaluate(() => {
    const stores: Storage[] = [];
    if (typeof window !== "undefined") {
      if (window.localStorage) stores.push(window.localStorage);
      if (window.sessionStorage) stores.push(window.sessionStorage);
    }
    const jwtLike = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
    };
    for (const store of stores) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (!key || !key.includes("@@auth0spajs@@")) continue;
        const raw = store.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          const candidate =
            jwtLike(parsed?.body?.access_token) ||
            jwtLike(parsed?.access_token) ||
            jwtLike(parsed?.accessToken) ||
            jwtLike(parsed?.credentialBody?.access_token);
          if (candidate) return candidate;
        } catch {
          continue;
        }
      }
    }
    return "";
  });

  if (!token) {
    throw new Error("Unable to capture Auth0 access token from SPA cache after login.");
  }
  return token;
}

async function apiJson(method: "GET" | "POST" | "PUT", path: string, token: string, body?: unknown): Promise<any> {
  const apiBase = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");
  const maxAttempts = method === "GET" ? 3 : 1;
  const backoffMs = [250, 750, 1500];
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(typeof body === "undefined" ? {} : { "Content-Type": "application/json" }),
        },
        ...(typeof body === "undefined" ? {} : { body: JSON.stringify(body) }),
      });
      const payload = await response.json();
      if (response.ok) return payload;
      if (attempt < maxAttempts && isTransientHttpStatus(response.status)) {
        await delay(backoffMs[attempt - 1] ?? 1500);
        continue;
      }
      throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const networkTransient =
        message.includes("fetch failed") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT");
      if (attempt < maxAttempts && networkTransient) {
        await delay(backoffMs[attempt - 1] ?? 1500);
        continue;
      }
      lastError = err instanceof Error ? err : new Error(message);
      break;
    }
  }

  throw lastError ?? new Error(`${method} ${path} failed after retries`);
}

async function apiJsonResponse(
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; payload: any }> {
  const apiBase = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof body === "undefined" ? {} : { "Content-Type": "application/json" }),
    },
    ...(typeof body === "undefined" ? {} : { body: JSON.stringify(body) }),
  });
  return { ok: response.ok, status: response.status, payload: await response.json() };
}

export async function ensureOwnerDeliveryGroupAccess(adminToken: string, ownerToken: string): Promise<void> {
  const ownerWhoami = await apiJson("GET", "/v1/whoami", ownerToken);
  const ownerActorId = String(ownerWhoami?.actor_id || "").trim();
  const ownerEmail = String(ownerWhoami?.email || "").trim().toLowerCase();
  if (!ownerActorId) throw new Error("whoami(owner) did not return actor_id");

  const groupId = process.env.GOV_DELIVERY_GROUP_ID?.trim() || "default";
  const requiredService = process.env.GOV_SERVICE?.trim() || "demo-service";
  const requiredEnvironment = process.env.GOV_ENVIRONMENT?.trim() || "sandbox";

  const groups = await apiJson("GET", "/v1/delivery-groups", adminToken);
  const existing = (Array.isArray(groups) ? groups : []).find((g: any) => g?.id === groupId);

  const base = {
    id: groupId,
    name: existing?.name || "Default Delivery Group",
    description: existing?.description || "Governance E2E bootstrap group",
    services: Array.from(new Set([...(Array.isArray(existing?.services) ? existing.services : []), requiredService])),
    allowed_environments: Array.from(
      new Set([...(Array.isArray(existing?.allowed_environments) ? existing.allowed_environments : [requiredEnvironment]), requiredEnvironment]),
    ),
    allowed_recipes:
      Array.isArray(existing?.allowed_recipes) && existing.allowed_recipes.length > 0 ? existing.allowed_recipes : ["default"],
    guardrails: existing?.guardrails || {
      max_concurrent_deployments: 1,
      daily_deploy_quota: 25,
      daily_rollback_quota: 10,
    },
    change_reason: "govtest e2e owner bootstrap",
  };

  const upsertWithOwner = async (ownerValue: string) => {
    const payload = { ...base, owner: ownerValue };
    return existing
      ? apiJsonResponse("PUT", `/v1/delivery-groups/${encodeURIComponent(groupId)}`, adminToken, payload)
      : apiJsonResponse("POST", "/v1/delivery-groups", adminToken, payload);
  };

  // Requested behavior: try actor_id first, fallback to email when API requires email-like owner.
  let upsert = await upsertWithOwner(ownerActorId);
  if (!upsert.ok) {
    const invalidOwner = upsert.status === 400 && upsert.payload?.code === "INVALID_OWNER";
    if (invalidOwner && ownerEmail) upsert = await upsertWithOwner(ownerEmail);
  }
  if (!upsert.ok) {
    throw new Error(`Delivery group upsert failed (${upsert.status}): ${JSON.stringify(upsert.payload)}`);
  }

  const envAdmin = await apiJson("GET", "/v1/environments", adminToken);
  const sandbox = (Array.isArray(envAdmin) ? envAdmin : []).find(
    (env: any) => env?.delivery_group_id === groupId && env?.name === requiredEnvironment,
  );
  if (!sandbox) throw new Error(`Environment ${requiredEnvironment} not found for delivery group ${groupId}.`);
  if (sandbox?.is_enabled !== true) throw new Error(`Environment ${requiredEnvironment} is disabled for delivery group ${groupId}.`);

  const envOwner = await apiJson("GET", "/v1/environments", ownerToken);
  const ownerSandbox = (Array.isArray(envOwner) ? envOwner : []).find(
    (env: any) => env?.delivery_group_id === groupId && env?.name === requiredEnvironment,
  );
  if (!ownerSandbox || ownerSandbox?.is_enabled !== true) {
    throw new Error(`Owner token is not scoped to enabled ${requiredEnvironment} in delivery group ${groupId}.`);
  }
}

export function ownerCredentialsFromEnv(): { username: string; password: string } {
  return {
    username: requiredEnv("GOV_OWNER_USERNAME"),
    password: requiredEnv("GOV_OWNER_PASSWORD"),
  };
}

export function adminCredentialsFromEnv(): { username: string; password: string } {
  return {
    username: requiredEnv("GOV_ADMIN_USERNAME"),
    password: requiredEnv("GOV_ADMIN_PASSWORD"),
  };
}
