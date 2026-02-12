"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTokenManager = createTokenManager;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REFRESH_BUFFER_SEC = 60;
function createTokenManager(options) {
    var _a;
    const fetchFn = (_a = options.fetchFn) !== null && _a !== void 0 ? _a : fetch;
    const logger = options.logger;
    let tokenState;
    async function fetchToken() {
        var _a, _b;
        const controller = new AbortController();
        const timeoutMs = (_a = options.auth.timeoutMs) !== null && _a !== void 0 ? _a : DEFAULT_TIMEOUT_MS;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const body = new URLSearchParams({
                grant_type: "client_credentials",
                client_id: options.auth.clientId,
                client_secret: options.auth.clientSecret,
                audience: options.auth.audience,
            });
            const response = await fetchFn(options.auth.tokenUrl, {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body,
                signal: controller.signal,
            });
            if (!response.ok) {
                (_b = logger === null || logger === void 0 ? void 0 : logger.warn) === null || _b === void 0 ? void 0 : _b.call(logger, "DXCP token fetch failed", {
                    status: response.status,
                });
                throw new Error(`Token fetch failed with status ${response.status}`);
            }
            const json = (await response.json());
            if (!json.access_token || !json.expires_in) {
                throw new Error("Token response missing access_token or expires_in");
            }
            const expiresAtMs = Date.now() + json.expires_in * 1000;
            return { accessToken: json.access_token, expiresAtMs };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async function getAccessToken() {
        var _a;
        const bufferSec = (_a = options.auth.tokenRefreshBufferSec) !== null && _a !== void 0 ? _a : DEFAULT_REFRESH_BUFFER_SEC;
        const bufferMs = bufferSec * 1000;
        if (tokenState && Date.now() < tokenState.expiresAtMs - bufferMs) {
            return tokenState.accessToken;
        }
        tokenState = await fetchToken();
        return tokenState.accessToken;
    }
    return {
        getAccessToken,
        _unsafeGetState: () => tokenState,
    };
}
