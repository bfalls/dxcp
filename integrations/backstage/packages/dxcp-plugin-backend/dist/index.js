"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTokenManager = exports.createDxcpHandlers = exports.createDxcpRouter = exports.DXCP_BACKEND_PLUGIN_ID = void 0;
exports.DXCP_BACKEND_PLUGIN_ID = "dxcp-backend";
var router_1 = require("./router");
Object.defineProperty(exports, "createDxcpRouter", { enumerable: true, get: function () { return router_1.createDxcpRouter; } });
Object.defineProperty(exports, "createDxcpHandlers", { enumerable: true, get: function () { return router_1.createDxcpHandlers; } });
var tokenManager_1 = require("./tokenManager");
Object.defineProperty(exports, "createTokenManager", { enumerable: true, get: function () { return tokenManager_1.createTokenManager; } });
// TODO: Publish to a registry / move to Backstage community plugins later.
