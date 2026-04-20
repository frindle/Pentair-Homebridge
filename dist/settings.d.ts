/**
 * Plugin and platform constants for homebridge-pentair-cloud.
 * All Cognito / API configuration lives here so it can be imported
 * from any module without circular dependencies.
 */
/** The platform name registered with Homebridge. */
export declare const PLATFORM_NAME = "PentairHomebridge";
/** The npm package name; used when registering the plugin. */
export declare const PLUGIN_NAME = "homebridge-pentair-cloud";
/** AWS region that hosts the Pentair Cognito User Pool and Identity Pool. */
export declare const AWS_REGION = "us-west-2";
/** Pentair Cognito User Pool ID. */
export declare const COGNITO_USER_POOL_ID = "us-west-2_lbiduhSwD";
/**
 * Cognito App Client ID used for USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH
 * flows.  No client secret is required (public client).
 */
export declare const COGNITO_CLIENT_ID = "3de110o697faq7avdchtf07h4v";
/** Cognito Identity Pool used to exchange the ID token for SigV4 credentials. */
export declare const COGNITO_IDENTITY_POOL_ID = "us-west-2:6f950f85-af44-43d9-b690-a431f753e9aa";
/**
 * The Cognito login key used when exchanging an ID token for Identity Pool
 * credentials.  Format: `cognito-idp.{region}.amazonaws.com/{userPoolId}`.
 */
export declare const COGNITO_LOGIN_KEY = "cognito-idp.us-west-2.amazonaws.com/us-west-2_lbiduhSwD";
/** Base hostname for all Pentair Cloud API calls (no trailing slash). */
export declare const API_BASE_HOST = "api.pentair.cloud";
/** Full base URL including scheme. */
export declare const API_BASE_URL = "https://api.pentair.cloud";
/** AWS service name used for SigV4 request signing. */
export declare const API_SERVICE_NAME = "execute-api";
/** List all devices belonging to the authenticated user. */
export declare const ENDPOINT_LIST_DEVICES = "/device/device-service/user/devices";
/** Get status for a single device (POST). */
export declare const ENDPOINT_DEVICE_STATUS = "/device2/device2-service/user/device";
/**
 * Send a command to a device (PUT).
 * Replace `{deviceId}` with the target device identifier before use.
 */
export declare const ENDPOINT_SEND_COMMAND = "/device/device-service/user/device/{deviceId}";
/** How often (ms) accessories poll the cloud for status updates. */
export declare const STATUS_POLL_INTERVAL_MS = 30000;
