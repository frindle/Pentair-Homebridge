/**
 * PentairAuth – handles AWS Cognito authentication and credential management
 * for the Pentair Cloud API.
 *
 * Authentication flow:
 *  1. USER_SRP_AUTH via amazon-cognito-identity-js (handles SRP crypto)
 *     → IdToken + RefreshToken
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
 * Manages Pentair Cloud authentication using AWS Cognito SRP auth.
 */
export declare class PentairAuth {
    private readonly username;
    private readonly password;
    private session;
    private readonly userPool;
    private readonly identityClient;
    constructor(username: string, password: string);
    /**
     * Performs the full two-step authentication:
     *  1. SRP auth → ID token + refresh token
     *  2. Cognito Identity Pool → temporary AWS credentials
     */
    authenticate(): Promise<void>;
    /**
     * Refreshes credentials if the ID token will expire within the next 5 minutes.
     */
    refreshIfNeeded(): Promise<void>;
    /**
     * Returns the current AWS credentials, refreshing them first if necessary.
     */
    getCredentials(): Promise<AwsCredentials>;
    /**
     * Authenticates using SRP via amazon-cognito-identity-js.
     */
    private fetchTokens;
    /**
     * Refreshes the session using the stored refresh token.
     */
    private refreshTokens;
    /**
     * Exchanges a Cognito ID token for temporary AWS credentials via the
     * Identity Pool.
     */
    private fetchCredentials;
}
