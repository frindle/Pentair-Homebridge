"use strict";
/**
 * Plugin and platform constants for homebridge-pentair-cloud.
 * All Cognito / API configuration lives here so it can be imported
 * from any module without circular dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_POLL_INTERVAL_MS = exports.ENDPOINT_SEND_COMMAND = exports.ENDPOINT_DEVICE_STATUS = exports.ENDPOINT_LIST_DEVICES = exports.API_SERVICE_NAME = exports.API_BASE_URL = exports.API_BASE_HOST = exports.COGNITO_LOGIN_KEY = exports.COGNITO_IDENTITY_POOL_ID = exports.COGNITO_CLIENT_ID = exports.COGNITO_USER_POOL_ID = exports.AWS_REGION = exports.PLUGIN_NAME = exports.PLATFORM_NAME = void 0;
/** The platform name registered with Homebridge. */
exports.PLATFORM_NAME = 'PentairHomebridge';
/** The npm package name; used when registering the plugin. */
exports.PLUGIN_NAME = 'homebridge-pentair-cloud';
// ---------------------------------------------------------------------------
// AWS / Cognito constants
// ---------------------------------------------------------------------------
/** AWS region that hosts the Pentair Cognito User Pool and Identity Pool. */
exports.AWS_REGION = 'us-west-2';
/** Pentair Cognito User Pool ID. */
exports.COGNITO_USER_POOL_ID = 'us-west-2_lbiduhSwD';
/**
 * Cognito App Client ID used for USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH
 * flows.  No client secret is required (public client).
 */
exports.COGNITO_CLIENT_ID = '3de110o697faq7avdchtf07h4v';
/** Cognito Identity Pool used to exchange the ID token for SigV4 credentials. */
exports.COGNITO_IDENTITY_POOL_ID = 'us-west-2:6f950f85-af44-43d9-b690-a431f753e9aa';
/**
 * The Cognito login key used when exchanging an ID token for Identity Pool
 * credentials.  Format: `cognito-idp.{region}.amazonaws.com/{userPoolId}`.
 */
exports.COGNITO_LOGIN_KEY = `cognito-idp.${exports.AWS_REGION}.amazonaws.com/${exports.COGNITO_USER_POOL_ID}`;
// ---------------------------------------------------------------------------
// API constants
// ---------------------------------------------------------------------------
/** Base hostname for all Pentair Cloud API calls (no trailing slash). */
exports.API_BASE_HOST = 'api.pentair.cloud';
/** Full base URL including scheme. */
exports.API_BASE_URL = `https://${exports.API_BASE_HOST}`;
/** AWS service name used for SigV4 request signing. */
exports.API_SERVICE_NAME = 'execute-api';
// ---------------------------------------------------------------------------
// Endpoint paths
// ---------------------------------------------------------------------------
/** List all devices belonging to the authenticated user. */
exports.ENDPOINT_LIST_DEVICES = '/device/device-service/user/devices';
/** Get status for a single device (POST). */
exports.ENDPOINT_DEVICE_STATUS = '/device2/device2-service/user/device';
/**
 * Send a command to a device (PUT).
 * Replace `{deviceId}` with the target device identifier before use.
 */
exports.ENDPOINT_SEND_COMMAND = '/device/device-service/user/device/{deviceId}';
// ---------------------------------------------------------------------------
// Polling interval
// ---------------------------------------------------------------------------
/** How often (ms) accessories poll the cloud for status updates. */
exports.STATUS_POLL_INTERVAL_MS = 30000;
