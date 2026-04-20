/**
 * PentairApi – thin HTTP client for the Pentair Home cloud API.
 *
 * Every request is signed with AWS Signature Version 4 using the temporary
 * credentials obtained by PentairAuth.  The underlying transport is the
 * global `fetch` API available in Node >=18.
 */
import type { Logger } from 'homebridge';
import type { PentairAuth } from './auth';
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
export declare class PentairApi {
    private readonly auth;
    private readonly log;
    constructor(auth: PentairAuth, log: Logger);
    /**
     * Retrieves all devices associated with the authenticated user account.
     *
     * @returns Array of device descriptors.
     */
    getDevices(): Promise<PentairDevice[]>;
    /**
     * Fetches the current status of a single device.
     *
     * @param deviceId - The Pentair device identifier.
     * @returns A flat key/value map of status fields.
     */
    getDeviceStatus(deviceId: string): Promise<DeviceStatus>;
    /**
     * Sends a command payload to a device.
     *
     * @param deviceId - The target device identifier.
     * @param payload  - Key/value command fields (e.g. `{ lse: '1' }`).
     */
    sendCommand(deviceId: string, payload: CommandPayload): Promise<void>;
    /**
     * Creates, signs, and sends an HTTP request to the Pentair API.
     *
     * @param method - HTTP method (GET | POST | PUT).
     * @param path   - API path, starting with '/'.
     * @param body   - Optional request body (will be JSON-serialised).
     * @returns Parsed JSON response body.
     */
    private signedRequest;
}
