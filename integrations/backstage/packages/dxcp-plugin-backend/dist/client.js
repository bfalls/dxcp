"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDxcpClient = createDxcpClient;
function createDxcpClient(options) {
    var _a;
    const fetchFn = (_a = options.fetchFn) !== null && _a !== void 0 ? _a : fetch;
    async function get(path) {
        var _a;
        const controller = new AbortController();
        const timeoutMs = (_a = options.requestTimeoutMs) !== null && _a !== void 0 ? _a : 8000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const token = await options.getAccessToken();
            const url = new URL(path, options.baseUrl);
            const response = await fetchFn(url.toString(), {
                method: "GET",
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: "application/json",
                },
                signal: controller.signal,
            });
            if (!response.ok) {
                const message = `DXCP request failed with status ${response.status}`;
                throw { status: response.status, message };
            }
            return response.json();
        }
        finally {
            clearTimeout(timeout);
        }
    }
    return {
        get,
    };
}
