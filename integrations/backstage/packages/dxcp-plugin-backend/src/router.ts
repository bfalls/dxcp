import express, { Request, Response, Router } from "express";
import { createDxcpClient, DxcpError } from "./client";
import { createTokenManager } from "./tokenManager";
import { DxcpBackendConfig, FetchLike, Logger } from "./types";

export type DxcpRouterOptions = {
  config: DxcpBackendConfig;
  logger?: Logger;
  fetchFn?: FetchLike;
};

type Handler = (req: Request, res: Response) => Promise<void>;

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ status, message });
}

export function createDxcpHandlers(options: DxcpRouterOptions) {
  const tokenManager = createTokenManager({
    auth: options.config.auth0,
    fetchFn: options.fetchFn,
    logger: options.logger,
  });

  const client = createDxcpClient({
    baseUrl: options.config.baseUrl,
    getAccessToken: tokenManager.getAccessToken,
    fetchFn: options.fetchFn,
    requestTimeoutMs: options.config.requestTimeoutMs,
  });

  const logWarn = (message: string, meta?: Record<string, unknown>) =>
    options.logger?.warn?.(message, meta);

  const health: Handler = async (_req, res) => {
    try {
      const data = await client.get("/v1/health");
      res.status(200).json(data);
    } catch (err) {
      const error = err as DxcpError;
      logWarn("DXCP health request failed", { status: error.status });
      sendError(res, error.status ?? 502, error.message ?? "DXCP request failed");
    }
  };

  const deliveryStatus: Handler = async (req, res) => {
    const service = req.params.service;
    try {
      const data = await client.get(`/v1/services/${encodeURIComponent(service)}/delivery-status`);
      res.status(200).json(data);
    } catch (err) {
      const error = err as DxcpError;
      logWarn("DXCP delivery-status request failed", {
        status: error.status,
        service,
      });
      sendError(res, error.status ?? 502, error.message ?? "DXCP request failed");
    }
  };

  const allowedActions: Handler = async (req, res) => {
    const service = req.params.service;
    try {
      const data = await client.get(`/v1/services/${encodeURIComponent(service)}/allowed-actions`);
      res.status(200).json(data);
    } catch (err) {
      const error = err as DxcpError;
      logWarn("DXCP allowed-actions request failed", {
        status: error.status,
        service,
      });
      sendError(res, error.status ?? 502, error.message ?? "DXCP request failed");
    }
  };

  return {
    health,
    deliveryStatus,
    allowedActions,
  };
}

export function createDxcpRouter(options: DxcpRouterOptions): Router {
  const router = express.Router();
  const handlers = createDxcpHandlers(options);

  router.get("/health", handlers.health);
  router.get("/services/:service/delivery-status", handlers.deliveryStatus);
  router.get("/services/:service/allowed-actions", handlers.allowedActions);

  return router;
}
