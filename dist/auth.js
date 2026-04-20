"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairAuth = void 0;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const client_cognito_identity_1 = require("@aws-sdk/client-cognito-identity");
const settings_1 = require("./settings");
/**
 * Parses the expiration time from a JWT without verifying the signature.
 * Returns a Unix epoch in seconds, or 0 on parse failure.
 */
function jwtExpiry(token) {
    try {
        const payload = token.split('.')[1];
        const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
        const parsed = JSON.parse(decoded);
        return parsed.exp ?? 0;
    }
    catch {
        return 0;
    }
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
class PentairAuth {
    constructor(username, password) {
        this.session = null;
        this.username = username;
        this.password = password;
        this.userPoolClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({
            region: settings_1.AWS_REGION,
        });
        this.identityClient = new client_cognito_identity_1.CognitoIdentityClient({
            region: settings_1.AWS_REGION,
        });
    }
    /**
     * Performs the full two-step authentication:
     *  1. USER_PASSWORD_AUTH → ID token + refresh token
     *  2. Cognito Identity Pool → temporary AWS credentials
     *
     * @throws {Error} if Cognito returns no authentication result or tokens.
     */
    async authenticate() {
        const { idToken, refreshToken } = await this.fetchTokens();
        const { credentials, expiry: credentialsExpiry } = await this.fetchCredentials(idToken);
        this.session = {
            idToken,
            refreshToken,
            idTokenExpiry: jwtExpiry(idToken),
            credentials,
            credentialsExpiry,
        };
    }
    /**
     * Refreshes credentials if the ID token will expire within the next 5 minutes.
     * Silently no-ops when the session is still fresh.
     *
     * @throws {Error} if refresh fails and no valid session exists.
     */
    async refreshIfNeeded() {
        const BUFFER_SECONDS = 300; // refresh 5 min before expiry
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!this.session) {
            await this.authenticate();
            return;
        }
        if (this.session.idTokenExpiry - nowSeconds > BUFFER_SECONDS) {
            return; // token is still valid
        }
        // Attempt refresh token flow first.
        try {
            const refreshed = await this.refreshTokens(this.session.refreshToken);
            const { credentials, expiry: credentialsExpiry } = await this.fetchCredentials(refreshed.idToken);
            this.session = {
                idToken: refreshed.idToken,
                // Refresh token may or may not be rotated; keep old one if not returned.
                refreshToken: refreshed.refreshToken ?? this.session.refreshToken,
                idTokenExpiry: jwtExpiry(refreshed.idToken),
                credentials,
                credentialsExpiry,
            };
        }
        catch {
            // Fall back to full re-authentication with username/password.
            await this.authenticate();
        }
    }
    /**
     * Returns the current AWS credentials, refreshing them first if necessary.
     *
     * @returns Temporary AWS credentials for SigV4 signing.
     */
    async getCredentials() {
        await this.refreshIfNeeded();
        if (!this.session) {
            throw new Error('PentairAuth: no session available after refresh attempt');
        }
        return this.session.credentials;
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Calls USER_PASSWORD_AUTH flow and extracts the ID + refresh tokens.
     */
    async fetchTokens() {
        const command = new client_cognito_identity_provider_1.InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: settings_1.COGNITO_CLIENT_ID,
            AuthParameters: {
                USERNAME: this.username,
                PASSWORD: this.password,
            },
        });
        const response = await this.userPoolClient.send(command);
        const result = response.AuthenticationResult;
        if (!result) {
            throw new Error('PentairAuth: Cognito returned no AuthenticationResult');
        }
        if (!result.IdToken || !result.RefreshToken) {
            throw new Error('PentairAuth: Cognito response missing IdToken or RefreshToken');
        }
        return {
            idToken: result.IdToken,
            refreshToken: result.RefreshToken,
        };
    }
    /**
     * Calls REFRESH_TOKEN_AUTH flow and returns the refreshed ID token.
     * The refresh token itself is only returned when Cognito rotates it.
     */
    async refreshTokens(refreshToken) {
        const command = new client_cognito_identity_provider_1.InitiateAuthCommand({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: settings_1.COGNITO_CLIENT_ID,
            AuthParameters: {
                REFRESH_TOKEN: refreshToken,
            },
        });
        const response = await this.userPoolClient.send(command);
        const result = response.AuthenticationResult;
        if (!result?.IdToken) {
            throw new Error('PentairAuth: token refresh returned no IdToken');
        }
        return {
            idToken: result.IdToken,
            refreshToken: result.RefreshToken,
        };
    }
    /**
     * Exchanges a Cognito ID token for temporary AWS credentials via the
     * Identity Pool.
     *
     * @param idToken - The Cognito User Pool ID token.
     * @returns Temporary AWS credentials and their expiry (Unix epoch seconds).
     */
    async fetchCredentials(idToken) {
        // Step 1: resolve the Identity Pool identity ID for this user.
        const getIdResponse = await this.identityClient.send(new client_cognito_identity_1.GetIdCommand({
            IdentityPoolId: settings_1.COGNITO_IDENTITY_POOL_ID,
            Logins: {
                [settings_1.COGNITO_LOGIN_KEY]: idToken,
            },
        }));
        const identityId = getIdResponse.IdentityId;
        if (!identityId) {
            throw new Error('PentairAuth: GetId returned no IdentityId');
        }
        // Step 2: exchange the identity ID + ID token for STS credentials.
        const credsResponse = await this.identityClient.send(new client_cognito_identity_1.GetCredentialsForIdentityCommand({
            IdentityId: identityId,
            Logins: {
                [settings_1.COGNITO_LOGIN_KEY]: idToken,
            },
        }));
        const rawCreds = credsResponse.Credentials;
        if (!rawCreds?.AccessKeyId ||
            !rawCreds.SecretKey ||
            !rawCreds.SessionToken) {
            throw new Error('PentairAuth: GetCredentialsForIdentity returned incomplete credentials');
        }
        // Use the actual STS expiry when available; fall back to ID token expiry.
        const expiry = rawCreds.Expiration
            ? Math.floor(rawCreds.Expiration.getTime() / 1000)
            : jwtExpiry(idToken);
        return {
            credentials: {
                accessKeyId: rawCreds.AccessKeyId,
                secretAccessKey: rawCreds.SecretKey,
                sessionToken: rawCreds.SessionToken,
            },
            expiry,
        };
    }
}
exports.PentairAuth = PentairAuth;
