"use strict";
/**
 * PentairApi – thin HTTP client for the Pentair Home cloud API.
 *
 * Every request is signed with AWS Signature Version 4 using the temporary
 * credentials obtained by PentairAuth.  The underlying transport is the
 * global `fetch` API available in Node >=18.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairApi = void 0;
const signature_v4_1 = require("@aws-sdk/signature-v4");
const sha256_js_1 = require("@aws-crypto/sha256-js");
const protocol_http_1 = require("@smithy/protocol-http");
const settings_1 = require("./settings");
/**
 * Low-level client for the Pentair Cloud REST API.
 *
 * Responsibilities:
 *  - SigV4-sign every outgoing request
 *  - Refresh credentials via `PentairAuth` before each call
 *  - Expose typed methods for each API operation
 */
class PentairApi {
    constructor(auth, log) {
        this.auth = auth;
        this.log = log;
    }
    // ---------------------------------------------------------------------------
    // Public API methods
    // ---------------------------------------------------------------------------
    /**
     * Retrieves all devices associated with the authenticated user account.
     *
     * @returns Array of device descriptors.
     */
    async getDevices() {
        const response = await this.signedRequest('GET', settings_1.ENDPOINT_LIST_DEVICES);
        // The API may return either an array directly or wrap it in a property.
        if (Array.isArray(response)) {
            return response;
        }
        if (response && typeof response === 'object') {
            const obj = response;
            // Common wrappers: { devices: [...] } or { data: [...] }
            for (const key of ['devices', 'data', 'items', 'results']) {
                if (Array.isArray(obj[key])) {
                    return obj[key];
                }
            }
        }
        this.log.warn('PentairApi: unexpected shape from getDevices, returning []');
        return [];
    }
    /**
     * Fetches the current status of a single device.
     *
     * @param deviceId - The Pentair device identifier.
     * @returns A flat key/value map of status fields.
     */
    async getDeviceStatus(deviceId) {
        const response = await this.signedRequest('POST', settings_1.ENDPOINT_DEVICE_STATUS, { deviceId });
        if (response && typeof response === 'object' && !Array.isArray(response)) {
            const obj = response;
            // Status may be nested under a "payload" or "data" key.
            for (const key of ['payload', 'data', 'status']) {
                if (obj[key] && typeof obj[key] === 'object') {
                    return obj[key];
                }
            }
            return obj;
        }
        this.log.warn('PentairApi: unexpected shape from getDeviceStatus');
        return {};
    }
    /**
     * Sends a command payload to a device.
     *
     * @param deviceId - The target device identifier.
     * @param payload  - Key/value command fields (e.g. `{ lse: '1' }`).
     */
    async sendCommand(deviceId, payload) {
        const path = settings_1.ENDPOINT_SEND_COMMAND.replace('{deviceId}', deviceId);
        await this.signedRequest('PUT', path, { payload });
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Creates, signs, and sends an HTTP request to the Pentair API.
     *
     * @param method - HTTP method (GET | POST | PUT).
     * @param path   - API path, starting with '/'.
     * @param body   - Optional request body (will be JSON-serialised).
     * @returns Parsed JSON response body.
     */
    async signedRequest(method, path, body) {
        // Ensure credentials are fresh before signing.
        const credentials = await this.auth.getCredentials();
        const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
        const headers = {
            host: settings_1.API_BASE_HOST,
        };
        if (bodyString) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(Buffer.byteLength(bodyString, 'utf-8'));
        }
        // Build the request object that SignatureV4 will sign.
        const request = new protocol_http_1.HttpRequest({
            method,
            protocol: 'https:',
            hostname: settings_1.API_BASE_HOST,
            path,
            headers,
            body: bodyString,
        });
        // Sign with SigV4.
        const signer = new signature_v4_1.SignatureV4({
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            },
            region: settings_1.AWS_REGION,
            service: settings_1.API_SERVICE_NAME,
            sha256: sha256_js_1.Sha256,
        });
        const signed = await signer.sign(request);
        // Convert signed headers to a plain object understood by fetch.
        const fetchHeaders = {};
        for (const [key, value] of Object.entries(signed.headers)) {
            fetchHeaders[key] = value;
        }
        const url = `https://${settings_1.API_BASE_HOST}${path}`;
        this.log.debug(`PentairApi: ${method} ${url}`);
        const fetchOptions = {
            method,
            headers: fetchHeaders,
        };
        if (bodyString) {
            fetchOptions.body = bodyString;
        }
        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`PentairApi: ${method} ${path} → HTTP ${response.status}: ${text}`);
        }
        // 204 No Content or similar – nothing to parse.
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
            return null;
        }
        const json = await response.json();
        return json;
    }
}
exports.PentairApi = PentairApi;
