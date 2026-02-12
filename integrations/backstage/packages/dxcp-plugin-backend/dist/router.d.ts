import { Request, Response, Router } from "express";
import { DxcpBackendConfig, FetchLike, Logger } from "./types";
export type DxcpRouterOptions = {
    config: DxcpBackendConfig;
    logger?: Logger;
    fetchFn?: FetchLike;
};
type Handler = (req: Request, res: Response) => Promise<void>;
export declare function createDxcpHandlers(options: DxcpRouterOptions): {
    health: Handler;
    deliveryStatus: Handler;
    allowedActions: Handler;
};
export declare function createDxcpRouter(options: DxcpRouterOptions): Router;
export {};
