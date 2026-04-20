/**
 * PentairAuth – handles AWS Cognito authentication and credential management
 * for the Pentair Cloud API.
 *
 * Authentication flow:
 *  1. USER_PASSWORD_AUTH via Cognito User Pool → IdToken + RefreshToken
 *  2. GetId + GetCredentialsForIdentity via Cognito Identity Pool
 *     → temporary AWS credentials (accessKeyId / secretAccessKey / sessionToken)
 *
 * The resulting credentials are used by PentairApi to sign every HTTP request
 * with AWS Signature Version 4.
 */
/** AWS credential set returned by Cognito Identity Pool. */
export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}
/**
 * Manages Pentair Cloud authentication using AWS Cognito.
 *
 * Usage:
 * ```ts
 * const auth = new PentairAuth('user@example.com', 'password');
 * await auth.authenticate();
 * const creds = await auth.getCredentials();
 * ```
 */
export declare class PentairAuth {
    private readonly username;
    private readonly password;
    private session;
    private readonly userPoolClient;
    private readonly identityClient;
    constructor(username: string, password: string);
    /**
     * Performs the full two-step authentication:
     *  1. USER_PASSWORD_AUTH → ID token + refresh token
     *  2. Cognito Identity Pool → temporary AWS credentials
     *
     * @throws {Error} if Cognito returns no authentication result or tokens.
     */
    authenticate(): Promise<void>;
    /**
     * Refreshes credentials if the ID token will expire within the next 5 minutes.
     * Silently no-ops when the session is still fresh.
     *
     * @throws {Error} if refresh fails and no valid session exists.
     */
    refreshIfNeeded(): Promise<void>;
    /**
     * Returns the current AWS credentials, refreshing them first if necessary.
     *
     * @returns Temporary AWS credentials for SigV4 signing.
     */
    getCredentials(): Promise<AwsCredentials>;
    /**
     * Calls USER_PASSWORD_AUTH flow and extracts the ID + refresh tokens.
     */
    private fetchTokens;
    /**
     * Calls REFRESH_TOKEN_AUTH flow and returns the refreshed ID token.
     * The refresh token itself is only returned when Cognito rotates it.
     */
    private refreshTokens;
    /**
     * Exchanges a Cognito ID token for temporary AWS credentials via the
     * Identity Pool.
     *
     * @param idToken - The Cognito User Pool ID token.
     * @returns Temporary AWS credentials and their expiry (Unix epoch seconds).
     */
    private fetchCredentials;
}
