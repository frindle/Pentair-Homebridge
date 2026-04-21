/**
 * PentairApi – thin HTTP client for the Pentair Home cloud API.
 *
 * Every request is signed with AWS Signature Version 4 using the temporary
 * credentials obtained by PentairAuth.  The underlying transport is the
 * global `fetch` API available in Node >=18.
 */

import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import type { Logger } from 'homebridge';
import type { PentairAuth } from './auth';
import {
  API_BASE_HOST,
  API_SERVICE_NAME,
  AWS_REGION,
  ENDPOINT_DEVICE_STATUS,
  ENDPOINT_LIST_DEVICES,
  ENDPOINT_SEND_COMMAND,
} from './settings';

/** Shape of a device returned by the list-devices endpoint. */
export interface PentairDevice {
  deviceId: string;
  deviceType?: string;
  name?: string;
  [key: string]: unknown;
}

/** Generic map of status fields returned by the device-status endpoint. */
export type DeviceStatus = Record<string, string | number | boolean | null>;

/** Payload sent to the send-command endpoint. */
export type CommandPayload = Record<string, string>;

/**
 * Low-level client for the Pentair Cloud REST API.
 *
 * Responsibilities:
 *  - SigV4-sign every outgoing request
 *  - Refresh credentials via `PentairAuth` before each call
 *  - Expose typed methods for each API operation
 */
export class PentairApi {
  private readonly auth: PentairAuth;
  private readonly log: Logger;

  constructor(auth: PentairAuth, log: Logger) {
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
  async getDevices(): Promise<PentairDevice[]> {
    const response = await this.signedRequest('GET', ENDPOINT_LIST_DEVICES);
    // The API may return either an array directly or wrap it in a property.
    if (Array.isArray(response)) {
      return response as PentairDevice[];
    }
    if (response && typeof response === 'object') {
      const obj = response as Record<string, unknown>;
      // Common wrappers: { devices: [...] } or { data: [...] }
      for (const key of ['devices', 'data', 'items', 'results']) {
        if (Array.isArray(obj[key])) {
          return obj[key] as PentairDevice[];
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
  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const response = await this.signedRequest(
      'POST',
      ENDPOINT_DEVICE_STATUS,
      { deviceId },
    );

    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const obj = response as Record<string, unknown>;
      // Status may be nested under a "payload" or "data" key.
      for (const key of ['payload', 'data', 'status']) {
        if (obj[key] && typeof obj[key] === 'object') {
          return obj[key] as DeviceStatus;
        }
      }
      return obj as DeviceStatus;
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
  async sendCommand(deviceId: string, payload: CommandPayload): Promise<void> {
    const path = ENDPOINT_SEND_COMMAND.replace('{deviceId}', deviceId);
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
  private async signedRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    // Ensure credentials are fresh before signing.
    const [credentials, idToken] = await Promise.all([
      this.auth.getCredentials(),
      this.auth.getIdToken(),
    ]);

    const bodyString = body !== undefined ? JSON.stringify(body) : undefined;

    const headers: Record<string, string> = {
      host: API_BASE_HOST,
      'x-amz-id-token': idToken,
      'user-agent': 'aws-amplify/4.3.10 react-native',
    };
    if (bodyString) {
      headers['content-type'] = 'application/json; charset=UTF-8';
      headers['content-length'] = String(Buffer.byteLength(bodyString, 'utf-8'));
    }

    // Build the request object that SignatureV4 will sign.
    const request = new HttpRequest({
      method,
      protocol: 'https:',
      hostname: API_BASE_HOST,
      path,
      headers,
      body: bodyString,
    });

    // Sign with SigV4.
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
      region: AWS_REGION,
      service: API_SERVICE_NAME,
      sha256: Sha256,
    });

    const signed = await signer.sign(request);

    // Convert signed headers to a plain object understood by fetch.
    const fetchHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(signed.headers)) {
      fetchHeaders[key] = value;
    }

    const url = `https://${API_BASE_HOST}${path}`;
    this.log.debug(`PentairApi: ${method} ${url}`);

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
    };
    if (bodyString) {
      fetchOptions.body = bodyString;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `PentairApi: ${method} ${path} → HTTP ${response.status}: ${text}`,
      );
    }

    // 204 No Content or similar – nothing to parse.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    const json: unknown = await response.json();
    return json;
  }
}
