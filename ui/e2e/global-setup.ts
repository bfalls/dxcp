import type { FullConfig } from "@playwright/test";
import { ensureGovBootstrapFromAuthStates } from "./helpers/authState";
import { loadGovtestEnv } from "./helpers/auth";

function missingGovEnv(): string[] {
  const required = [
    "GOV_AUTH0_DOMAIN",
    "GOV_AUTH0_AUDIENCE",
    "GOV_DXCP_UI_CLIENT_ID",
    "GOV_ADMIN_USERNAME",
    "GOV_ADMIN_PASSWORD",
    "GOV_OWNER_USERNAME",
    "GOV_OWNER_PASSWORD",
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

  try {
    await ensureGovBootstrapFromAuthStates();
    delete process.env.GOV_BOOTSTRAP_SKIP_REASON;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.env.GOV_BOOTSTRAP_SKIP_REASON = message;
    console.log(`[global-setup] skipping governance bootstrap: ${message}`);
  }
}
