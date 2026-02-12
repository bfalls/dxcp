"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDxcpHandlers = createDxcpHandlers;
exports.createDxcpRouter = createDxcpRouter;
const express_1 = __importDefault(require("express"));
const client_1 = require("./client");
const tokenManager_1 = require("./tokenManager");
function sendError(res, status, message) {
    res.status(status).json({ status, message });
}
function createDxcpHandlers(options) {
    const tokenManager = (0, tokenManager_1.createTokenManager)({
        auth: options.config.auth0,
        fetchFn: options.fetchFn,
        logger: options.logger,
    });
    const client = (0, client_1.createDxcpClient)({
        baseUrl: options.config.baseUrl,
        getAccessToken: tokenManager.getAccessToken,
        fetchFn: options.fetchFn,
        requestTimeoutMs: options.config.requestTimeoutMs,
    });
    const logWarn = (message, meta) => { var _a, _b; return (_b = (_a = options.logger) === null || _a === void 0 ? void 0 : _a.warn) === null || _b === void 0 ? void 0 : _b.call(_a, message, meta); };
    const health = async (_req, res) => {
        var _a, _b;
        try {
            const data = await client.get("/v1/health");
            res.status(200).json(data);
        }
        catch (err) {
            const error = err;
            logWarn("DXCP health request failed", { status: error.status });
            sendError(res, (_a = error.status) !== null && _a !== void 0 ? _a : 502, (_b = error.message) !== null && _b !== void 0 ? _b : "DXCP request failed");
        }
    };
    const deliveryStatus = async (req, res) => {
        var _a, _b;
        const service = req.params.service;
        try {
            const data = await client.get(`/v1/services/${encodeURIComponent(service)}/delivery-status`);
            res.status(200).json(data);
        }
        catch (err) {
            const error = err;
            logWarn("DXCP delivery-status request failed", {
                status: error.status,
                service,
            });
            sendError(res, (_a = error.status) !== null && _a !== void 0 ? _a : 502, (_b = error.message) !== null && _b !== void 0 ? _b : "DXCP request failed");
        }
    };
    const allowedActions = async (req, res) => {
        var _a, _b;
        const service = req.params.service;
        try {
            const data = await client.get(`/v1/services/${encodeURIComponent(service)}/allowed-actions`);
            res.status(200).json(data);
        }
        catch (err) {
            const error = err;
            logWarn("DXCP allowed-actions request failed", {
                status: error.status,
                service,
            });
            sendError(res, (_a = error.status) !== null && _a !== void 0 ? _a : 502, (_b = error.message) !== null && _b !== void 0 ? _b : "DXCP request failed");
        }
    };
    return {
        health,
        deliveryStatus,
        allowedActions,
    };
}
function createDxcpRouter(options) {
    const router = express_1.default.Router();
    const handlers = createDxcpHandlers(options);
    router.get("/health", handlers.health);
    router.get("/services/:service/delivery-status", handlers.deliveryStatus);
    router.get("/services/:service/allowed-actions", handlers.allowedActions);
    return router;
}
