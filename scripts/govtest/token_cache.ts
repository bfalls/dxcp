import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
};

type CachedTokenEntry = {
  token: string;
  exp: number;
  cachedAt: string;
};

type TokenCacheFile = {
  version: 1;
  tokens: Record<string, CachedTokenEntry>;
};

type TokenExpectation = {
  iss?: string;
  aud?: string;
  azp?: string;
};

const TOKEN_CACHE_FILE = join(process.cwd(), ".govtest.tokens.json");
const TOKEN_MIN_TTL_SECONDS = 120;

function b64UrlDecode(input: string): string {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4 || 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("token does not have 3 parts");
  }
  return JSON.parse(b64UrlDecode(parts[1])) as JwtClaims;
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

function claimsMatchExpectation(claims: JwtClaims, expectation: TokenExpectation): boolean {
  if (expectation.iss) {
    const claimIss = typeof claims.iss === "string" ? normalizeIssuer(claims.iss) : "";
    if (claimIss !== normalizeIssuer(expectation.iss)) {
      return false;
    }
  }
  if (expectation.azp && claims.azp !== expectation.azp) {
    return false;
  }
  if (expectation.aud) {
    const aud = claims.aud;
    if (typeof aud === "string") {
      if (aud !== expectation.aud) {
        return false;
      }
    } else if (Array.isArray(aud)) {
      if (!aud.includes(expectation.aud)) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function readCacheFile(): TokenCacheFile {
  if (!existsSync(TOKEN_CACHE_FILE)) {
    return { version: 1, tokens: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(TOKEN_CACHE_FILE, "utf8")) as Partial<TokenCacheFile>;
    if (parsed.version !== 1 || typeof parsed.tokens !== "object" || !parsed.tokens) {
      return { version: 1, tokens: {} };
    }
    return { version: 1, tokens: parsed.tokens as Record<string, CachedTokenEntry> };
  } catch {
    return { version: 1, tokens: {} };
  }
}

function writeCacheFile(cache: TokenCacheFile): void {
  writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

export function tokenCacheEnabled(): boolean {
  const raw = process.env.GOV_TOKEN_CACHE?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

export function getCachedToken(cacheKey: string, expectation: TokenExpectation): string | undefined {
  if (!tokenCacheEnabled()) return undefined;
  const cache = readCacheFile();
  const entry = cache.tokens[cacheKey];
  if (!entry || !entry.token) return undefined;

  try {
    const claims = decodeJwtClaims(entry.token);
    const exp = Number(claims.exp ?? entry.exp);
    if (!Number.isFinite(exp) || exp <= nowEpochSeconds() + TOKEN_MIN_TTL_SECONDS) {
      return undefined;
    }
    if (!claimsMatchExpectation(claims, expectation)) {
      return undefined;
    }
    return entry.token;
  } catch {
    return undefined;
  }
}

export function putCachedToken(cacheKey: string, token: string): void {
  if (!tokenCacheEnabled()) return;
  try {
    const claims = decodeJwtClaims(token);
    const exp = Number(claims.exp);
    if (!Number.isFinite(exp)) {
      return;
    }
    const cache = readCacheFile();
    cache.tokens[cacheKey] = {
      token,
      exp,
      cachedAt: new Date().toISOString(),
    };
    writeCacheFile(cache);
  } catch {
    // ignore malformed token cache writes
  }
}
