const test = require("node:test");
const assert = require("node:assert/strict");

const { createDxcpHandlers } = require("../dist/index.js");

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("health handler returns DXCP response", async () => {
  const fetchFn = async (url) => {
    if (url.toString().includes("oauth/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      };
    }
    if (url.toString().includes("/v1/health")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const handlers = createDxcpHandlers({
    config: {
      baseUrl: "https://dxcp.example.com",
      auth0: {
        tokenUrl: "https://auth.example.com/oauth/token",
        clientId: "client",
        clientSecret: "secret",
        audience: "https://dxcp-api",
      },
    },
    fetchFn,
  });

  const res = createMockRes();
  await handlers.health({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("delivery-status handler returns error shape", async () => {
  const fetchFn = async (url) => {
    if (url.toString().includes("oauth/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      };
    }
    return {
      ok: false,
      status: 503,
      json: async () => ({ message: "unavailable" }),
    };
  };

  const handlers = createDxcpHandlers({
    config: {
      baseUrl: "https://dxcp.example.com",
      auth0: {
        tokenUrl: "https://auth.example.com/oauth/token",
        clientId: "client",
        clientSecret: "secret",
        audience: "https://dxcp-api",
      },
    },
    fetchFn,
  });

  const res = createMockRes();
  await handlers.deliveryStatus({ params: { service: "demo-service" } }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 503);
  assert.match(res.body.message, /DXCP request failed/);
});
