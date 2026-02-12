const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DXCP_SERVICE_ANNOTATION,
  getDxcpServiceAnnotation,
  buildDxcpViewModel,
} = require("../dist/index.js");

test("extracts dxcp.io/service annotation", () => {
  const entity = {
    metadata: {
      annotations: {
        [DXCP_SERVICE_ANNOTATION]: "demo-service",
      },
    },
  };

  assert.equal(getDxcpServiceAnnotation(entity), "demo-service");
});

test("builds view model from delivery status and allowed actions", () => {
  const deliveryStatus = {
    state: "SUCCEEDED",
    version: "1.2.3",
    updatedAt: "2026-02-12T18:00:00Z",
    engineExecutionUrl: "https://engine.example.com/execution/123",
  };
  const allowedActions = {
    allowedActions: [
      { name: "deploy", allowed: true },
      { name: "rollback", allowed: false },
    ],
  };

  const viewModel = buildDxcpViewModel(deliveryStatus, allowedActions);
  assert.equal(viewModel.deliveryStatus.state, "SUCCEEDED");
  assert.equal(viewModel.deliveryStatus.version, "1.2.3");
  assert.equal(viewModel.allowedActions.length, 2);
  assert.equal(viewModel.allowedActions[1].allowed, false);
});
