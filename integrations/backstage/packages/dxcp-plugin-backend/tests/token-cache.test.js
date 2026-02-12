const test = require("node:test");
const assert = require("node:assert/strict");

const { createTokenManager } = require("../dist/index.js");

test("token manager caches token until refresh buffer", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `token-${calls}`,
        expires_in: 3600,
      }),
    };
  };

  const manager = createTokenManager({
    auth: {
      tokenUrl: "https://auth.example.com/oauth/token",
      clientId: "client",
      clientSecret: "secret",
      audience: "https://dxcp-api",
      tokenRefreshBufferSec: 60,
    },
    fetchFn,
  });

  const token1 = await manager.getAccessToken();
  const token2 = await manager.getAccessToken();

  assert.equal(token1, "token-1");
  assert.equal(token2, "token-1");
  assert.equal(calls, 1);
});

test("token manager refreshes when within buffer", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `token-${calls}`,
        expires_in: 30,
      }),
    };
  };

  const manager = createTokenManager({
    auth: {
      tokenUrl: "https://auth.example.com/oauth/token",
      clientId: "client",
      clientSecret: "secret",
      audience: "https://dxcp-api",
      tokenRefreshBufferSec: 60,
    },
    fetchFn,
  });

  const token1 = await manager.getAccessToken();
  const token2 = await manager.getAccessToken();

  assert.equal(token1, "token-1");
  assert.equal(token2, "token-2");
  assert.equal(calls, 2);
});
