import { DxcpAuthConfig, FetchLike, Logger } from "./types";
type TokenState = {
    accessToken: string;
    expiresAtMs: number;
};
export type TokenManagerOptions = {
    auth: DxcpAuthConfig;
    fetchFn?: FetchLike;
    logger?: Logger;
};
export declare function createTokenManager(options: TokenManagerOptions): {
    getAccessToken: () => Promise<string>;
    _unsafeGetState: () => TokenState | undefined;
};
export {};
