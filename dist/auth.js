"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairAuth = void 0;
const amazon_cognito_identity_js_1 = require("amazon-cognito-identity-js");
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
 * Manages Pentair Cloud authentication using AWS Cognito SRP auth.
 */
class PentairAuth {
    constructor(username, password) {
        this.session = null;
        this.username = username;
        this.password = password;
        this.userPool = new amazon_cognito_identity_js_1.CognitoUserPool({
            UserPoolId: settings_1.COGNITO_USER_POOL_ID,
            ClientId: settings_1.COGNITO_CLIENT_ID,
        });
        this.identityClient = new client_cognito_identity_1.CognitoIdentityClient({
            region: settings_1.AWS_REGION,
        });
    }
    /**
     * Performs the full two-step authentication:
     *  1. SRP auth → ID token + refresh token
     *  2. Cognito Identity Pool → temporary AWS credentials
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
     */
    async refreshIfNeeded() {
        const BUFFER_SECONDS = 300;
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!this.session) {
            await this.authenticate();
            return;
        }
        if (this.session.idTokenExpiry - nowSeconds > BUFFER_SECONDS) {
            return;
        }
        try {
            const refreshed = await this.refreshTokens(this.session.refreshToken);
            const { credentials, expiry: credentialsExpiry } = await this.fetchCredentials(refreshed.idToken);
            this.session = {
                idToken: refreshed.idToken,
                refreshToken: this.session.refreshToken,
                idTokenExpiry: jwtExpiry(refreshed.idToken),
                credentials,
                credentialsExpiry,
            };
        }
        catch {
            await this.authenticate();
        }
    }
    /**
     * Returns the current AWS credentials, refreshing them first if necessary.
     */
    async getCredentials() {
        await this.refreshIfNeeded();
        if (!this.session) {
            throw new Error('PentairAuth: no session available after refresh attempt');
        }
        return this.session.credentials;
    }
    /**
     * Returns the current Cognito ID token, refreshing if necessary.
     * Required as the x-amz-id-token header on every API request.
     */
    async getIdToken() {
        await this.refreshIfNeeded();
        if (!this.session) {
            throw new Error('PentairAuth: no session available after refresh attempt');
        }
        return this.session.idToken;
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Authenticates using SRP via amazon-cognito-identity-js.
     */
    fetchTokens() {
        return new Promise((resolve, reject) => {
            const cognitoUser = new amazon_cognito_identity_js_1.CognitoUser({
                Username: this.username,
                Pool: this.userPool,
            });
            cognitoUser.authenticateUser(new amazon_cognito_identity_js_1.AuthenticationDetails({
                Username: this.username,
                Password: this.password,
            }), {
                onSuccess: (session) => {
                    resolve({
                        idToken: session.getIdToken().getJwtToken(),
                        refreshToken: session.getRefreshToken().getToken(),
                    });
                },
                onFailure: reject,
            });
        });
    }
    /**
     * Refreshes the session using the stored refresh token.
     */
    refreshTokens(refreshToken) {
        return new Promise((resolve, reject) => {
            const cognitoUser = new amazon_cognito_identity_js_1.CognitoUser({
                Username: this.username,
                Pool: this.userPool,
            });
            cognitoUser.refreshSession(new amazon_cognito_identity_js_1.CognitoRefreshToken({ RefreshToken: refreshToken }), (err, session) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ idToken: session.getIdToken().getJwtToken() });
            });
        });
    }
    /**
     * Exchanges a Cognito ID token for temporary AWS credentials via the
     * Identity Pool.
     */
    async fetchCredentials(idToken) {
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
