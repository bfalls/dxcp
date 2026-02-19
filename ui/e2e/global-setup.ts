import type { FullConfig } from "@playwright/test";
import { ensureAuthState } from "./helpers/authState";
import { loadGovtestEnv } from "./helpers/auth";

function missingGovEnv(): string[] {
  const required = [
    "GOV_DXCP_UI_BASE",
    "GOV_AUTH0_DOMAIN",
    "GOV_DXCP_UI_CLIENT_ID",
    "GOV_ADMIN_USERNAME",
    "GOV_ADMIN_PASSWORD",
    "GOV_OWNER_USERNAME",
    "GOV_OWNER_PASSWORD",
    "GOV_OBSERVER_USERNAME",
    "GOV_OBSERVER_PASSWORD",
  ];
  return required.filter((key) => !process.env[key]?.trim());
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadGovtestEnv();
  const missing = missingGovEnv();
  if (missing.length > 0) {
    console.log(`[global-setup] skipping auth state generation, missing: ${missing.join(", ")}`);
    return;
  }

  const force = process.env.CI === "true";
  await ensureAuthState("owner", { force });
  await ensureAuthState("admin", { force });
  await ensureAuthState("observer", { force });
}

