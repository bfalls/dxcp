import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunContext, JwtClaims, WhoAmI } from "./types.ts";

const VERSION_RE = /^0\.(\d+)\.(\d+)$/;
const SEMVER_IN_TEXT_RE = /(?:^|[^0-9])v?(0\.\d+\.\d+)(?:[^0-9]|$)/;

function nowIso(): string {
  return new Date().toISOString();
}

function logInfo(message: string): void {
  console.log(`[INFO] ${message}`);
}

function logStep(message: string): void {
  console.log(`[STEP] ${message}`);
}

function redactToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function fail(message: string): never {
  throw new Error(message);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

export async function decodeJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(`Expected JSON response but received: ${text.slice(0, 300)}`);
  }
}

export async function assertStatus(
  response: Response,
  expectedStatus: number,
  context: string,
  expectedCode?: string,
): Promise<any> {
  const payload = await decodeJson(response);
  if (response.status !== expectedStatus) {
    fail(
      `${context} failed: expected HTTP ${expectedStatus}, got ${response.status}; body=${JSON.stringify(payload)}`,
    );
  }
  if (expectedCode) {
    const code = payload?.code;
    if (code !== expectedCode) {
      fail(`${context} failed: expected code=${expectedCode}, got code=${code}`);
    }
  }
  return payload;
}

export async function apiRequest(
  method: string,
  path: string,
  token: string,
  options?: {
    idempotencyKey?: string;
    body?: any;
  },
): Promise<Response> {
  const base = requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options?.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  let body: string | undefined;
  if (typeof options?.body !== "undefined") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return fetch(`${base}${path}`, { method, headers, body });
}

export function loadLocalDotenv(dotenvPath = ".env.govtest"): void {
  if (process.env.GITHUB_ACTIONS === "true") {
    return;
  }
  const fullPath = join(process.cwd(), dotenvPath);
  if (!existsSync(fullPath)) {
    logInfo(`No ${dotenvPath} file found; using environment only.`);
    return;
  }
  const text = readFileSync(fullPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!key || process.env[key]) {
      continue;
    }
    process.env[key] = value;
  }
  logInfo(`Loaded ${dotenvPath}`);
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function b64UrlDecode(input: string): string {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4 || 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    fail("JWT decode failed: token does not have 3 parts.");
  }
  try {
    return JSON.parse(b64UrlDecode(parts[1]));
  } catch {
    fail("JWT decode failed: payload is not valid JSON.");
  }
}

async function getClientCredentialsToken(params: {
  domain: string;
  audience: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const tokenUrl = `https://${params.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/oauth/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      audience: params.audience,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  const payload = await decodeJson(response);
  if (!response.ok) {
    fail(`Auth0 token request failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  const token = payload?.access_token;
  if (typeof token !== "string" || !token) {
    fail("Auth0 token response missing access_token.");
  }
  return token;
}

type RoleName = "admin" | "owner" | "observer" | "ci";

export async function ensureCiToken(): Promise<string> {
  const existing = optionalEnv("GOV_CI_TOKEN");
  if (existing) {
    logInfo("Using GOV_CI_TOKEN from environment.");
    return existing;
  }

  const domain = requiredEnv("GOV_AUTH0_DOMAIN");
  const audience = requiredEnv("GOV_AUTH0_AUDIENCE");
  const clientId = requiredEnv("GOV_CI_CLIENT_ID");
  const clientSecret = requiredEnv("GOV_CI_CLIENT_SECRET");

  logInfo("Minting Auth0 token for role=ci");
  const token = await getClientCredentialsToken({
    domain,
    audience,
    clientId,
    clientSecret,
  });
  process.env.GOV_CI_TOKEN = token;
  logInfo(`Minted role=ci token=${redactToken(token)}`);
  return token;
}

function extractVersionCandidate(raw: any): string | undefined {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return undefined;
    if (VERSION_RE.test(value)) return value;
    const match = value.match(SEMVER_IN_TEXT_RE);
    return match?.[1];
  }
  if (raw && typeof raw === "object") {
    for (const key of ["version", "name", "artifactRef", "artifact_ref", "key"]) {
      const candidate = raw[key];
      const normalized = extractVersionCandidate(candidate);
      if (normalized) return normalized;
    }
  }
  if (typeof raw !== "undefined" && raw !== null) {
    return extractVersionCandidate(String(raw));
  }
  return undefined;
}

async function fetchVersions(ownerToken: string, service: string): Promise<string[]> {
  const response = await apiRequest("GET", `/v1/services/${service}/versions`, ownerToken);
  const payload = await decodeJson(response);
  if (!response.ok) {
    fail(`Version fetch failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.versions) ? payload.versions : null;
  if (!source) {
    fail("Unsupported version response shape; expected [] or { versions: [] }.");
  }

  const normalized = source
    .map((entry) => extractVersionCandidate(entry))
    .filter((v): v is string => typeof v === "string");

  return normalized;
}

async function fetchSeedArtifactRef(ownerToken: string, service: string, version: string): Promise<string | undefined> {
  const path = `/v1/builds?service=${encodeURIComponent(service)}&version=${encodeURIComponent(version)}`;
  const response = await apiRequest("GET", path, ownerToken);
  const payload = await decodeJson(response);
  if (!response.ok) {
    logInfo(`Seed build lookup failed for ${service}@${version}; fallback artifactRef will be used.`);
    return undefined;
  }
  return typeof payload?.artifactRef === "string" ? payload.artifactRef : undefined;
}

function computeRunVersion(versions: string[]): { runMinor: number; runVersion: string } {
  const targetMinor = 1;
  const patches: number[] = [];
  for (const version of versions) {
    const match = version.match(VERSION_RE);
    if (!match) continue;
    const minor = Number(match[1]);
    const patch = Number(match[2]);
    if (minor === targetMinor) {
      patches.push(patch);
    }
  }
  const maxPatch = patches.length ? Math.max(...patches) : 0;
  return { runMinor: targetMinor, runVersion: `0.${targetMinor}.${maxPatch + 1}` };
}

function nextPatchVersion(version: string): string {
  const match = version.match(VERSION_RE);
  if (!match) {
    fail(`Cannot compute next patch version from ${version}`);
  }
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  return `0.${minor}.${patch + 1}`;
}

export async function buildRunContext(tokens: Record<RoleName, string>): Promise<RunContext> {
  const service = optionalEnv("GOV_SERVICE") ?? "demo-service";
  const environment = optionalEnv("GOV_ENVIRONMENT") ?? "sandbox";
  const recipeId = optionalEnv("GOV_RECIPE_ID") ?? "default";
  const versions = await fetchVersions(tokens.owner, service);
  const { runMinor, runVersion } = computeRunVersion(versions);

  const seedVersion = versions.find((v) => VERSION_RE.test(v));
  const seedArtifactRef = seedVersion ? await fetchSeedArtifactRef(tokens.owner, service, seedVersion) : undefined;

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return {
    runId,
    startedAtIso: nowIso(),
    service,
    environment,
    recipeId,
    runVersion,
    conflictVersion: nextPatchVersion(runVersion),
    runMinor,
    unregisteredVersion: `0.${runMinor}.999`,
    idempotencyKeys: {
      gateNegative: `govtest-${runId}-gate-negative`,
      ciRegister: `govtest-${runId}-ci-register`,
      ciConflict: `govtest-${runId}-ci-conflict`,
      deployUnregistered: `govtest-${runId}-deploy-unregistered`,
      deployRegistered: `govtest-${runId}-deploy-registered`,
      rollbackSubmit: `govtest-${runId}-rollback-submit`,
    },
    timings: {
      stepStart: {},
      stepEnd: {},
    },
    discovered: {
      versionsEndpoint: `${requiredEnv("GOV_DXCP_API_BASE").replace(/\/$/, "")}/v1/services/${service}/versions`,
      discoveredVersions: versions,
      seedVersion,
      seedArtifactRef,
    },
    identity: {},
    deployment: {},
    rollback: {},
  };
}

export function buildRegisterExistingPayload(context: RunContext, overrides?: Partial<Record<string, any>>): any {
  const artifactRef =
    context.discovered.seedArtifactRef ??
    `s3://dxcp-test-bucket/${context.service}/${context.service}-${context.runVersion}.zip`;

  const base = {
    service: context.service,
    version: context.runVersion,
    artifactRef,
    git_sha: "a".repeat(40),
    git_branch: "main",
    ci_provider: "github_actions",
    ci_run_id: context.runId,
    built_at: nowIso(),
    repo: "dxcp",
    actor: "govtest",
    checksum_sha256: "",
  };

  return { ...base, ...(overrides ?? {}) };
}

export function buildDeploymentIntent(context: RunContext, version: string): any {
  return {
    service: context.service,
    environment: context.environment,
    version,
    changeSummary: `govtest ${context.runId} deploy ${version}`,
    recipeId: context.recipeId,
  };
}

export async function whoAmI(token: string): Promise<WhoAmI> {
  const response = await apiRequest("GET", "/v1/whoami", token);
  const payload = await assertStatus(response, 200, "GET /v1/whoami");
  return payload as WhoAmI;
}

export function markStepStart(context: RunContext, stepName: string): void {
  context.timings.stepStart[stepName] = nowIso();
}

export function markStepEnd(context: RunContext, stepName: string): void {
  context.timings.stepEnd[stepName] = nowIso();
}

export function printRunPlan(context: RunContext): void {
  logInfo("Run Plan");
  console.log(`  runId: ${context.runId}`);
  console.log(`  service: ${context.service}`);
  console.log(`  environment: ${context.environment}`);
  console.log(`  recipeId: ${context.recipeId}`);
  console.log(`  versions_endpoint: ${context.discovered.versionsEndpoint}`);
  console.log(`  discovered_versions: ${context.discovered.discoveredVersions.length}`);
  console.log(`  GOV_RUN_VERSION: ${context.runVersion}`);
  console.log(`  GOV_CONFLICT_VERSION: ${context.conflictVersion}`);
  console.log(`  GOV_UNREGISTERED_VERSION: ${context.unregisteredVersion}`);
}

export function announceStep(label: string): void {
  logStep(label);
}

export function printIdentity(role: string, token: string, claims: JwtClaims, whoamiPayload: WhoAmI): void {
  const roles = Array.isArray(whoamiPayload.roles) ? whoamiPayload.roles : [];
  logInfo(
    `Identity role=${role} email=${whoamiPayload.email ?? claims.email ?? ""} sub=${whoamiPayload.sub ?? claims.sub ?? ""} azp=${whoamiPayload.azp ?? claims.azp ?? ""} aud=${JSON.stringify(
      whoamiPayload.aud ?? claims.aud ?? "",
    )} iss=${whoamiPayload.iss ?? claims.iss ?? ""} roles=${JSON.stringify(roles)} token=${redactToken(token)}`,
  );
}
