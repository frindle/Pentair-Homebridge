/**
 * PentairAuth – handles AWS Cognito authentication and credential management
 * for the Pentair Cloud API.
 *
 * Authentication flow:
 *  1. SRP authentication via USER_SRP_AUTH flow — pure Node.js crypto
 *     (no amazon-cognito-identity-js) via @aws-sdk/client-cognito-identity-provider
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
export declare class PentairAuth {
    private readonly username;
    private readonly password;
    private session;
    private readonly idpClient;
    private readonly identityClient;
    constructor(username: string, password: string);
    authenticate(): Promise<void>;
    refreshIfNeeded(): Promise<void>;
    getCredentials(): Promise<AwsCredentials>;
    getIdToken(): Promise<string>;
    private fetchTokens;
    private refreshTokens;
    private fetchCredentials;
    private computePasswordVerifierProof;
}
