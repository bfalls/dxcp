import { FetchLike } from "./types";
export type DxcpClientOptions = {
    baseUrl: string;
    getAccessToken: () => Promise<string>;
    fetchFn?: FetchLike;
    requestTimeoutMs?: number;
};
export type DxcpError = {
    status: number;
    message: string;
};
export declare function createDxcpClient(options: DxcpClientOptions): {
    get: (path: string) => Promise<unknown>;
};
