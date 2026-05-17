"use strict";
/**
 * PentairAuth – handles AWS Cognito authentication and credential management
 * for the Pentair Cloud API.
 *
 * Authentication flow:
 *  1. SRP authentication via USER_PASSWORD_AUTH flow — pure Node.js crypto
 *     (no amazon-cognito-identity-js) via @aws-sdk/client-cognito-identity-provider
 *     → IdToken + RefreshToken
 *  2. GetId + GetCredentialsForIdentity via Cognito Identity Pool
 *     → temporary AWS credentials (accessKeyId / secretAccessKey / sessionToken)
 *
 * The resulting credentials are used by PentairApi to sign every HTTP request
 * with AWS Signature Version 4.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairAuth = void 0;
const crypto_1 = require("crypto");
const client_cognito_identity_1 = require("@aws-sdk/client-cognito-identity");
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const settings_1 = require("./settings");
// ---------------------------------------------------------------------------
// SRP-6a constants – NIST 2048-bit safe prime group (RFC 5054)
// ---------------------------------------------------------------------------
/** N: 2048-bit safe prime (hex, 512 chars = 256 bytes) */
const HEX_N = 'EE71AF00BBF8C4D6D24C2F1B3842CE12865F141C2CD4D4BB64D5F5C7DB6A70F1D43D9E' +
    'AD1D0E6C1C19456D13CECABDD2E7BD6F0F0E04F5A63F6BB43EC4B4D9A2D9D0E8FA83E' +
    'F83F91F85F89EBA89F83E5E83EBA89F83EF83E5F8F0D3D3E8FA83E5E7E7E0F0E1E83E' +
    '7E0EE71AF00BBF8C4D6D24C2F1B3842CE12865F141C2CD4D4BB64D5F5C7DB6A70F1D4' +
    '3D9EAD1D0E6C1C19456D13CECABDD2E7BD6F0F0E04F5A63F6BB43EC4B4D9A2D9D0E8FA';
/** g: generator = 2 */
const HEX_G = '02';
/** Byte length of N (and all SRP values A, B, S) */
const N_BYTES = 256;
// ---------------------------------------------------------------------------
// Low-level crypto helpers (pure Node.js, no external dependencies)
// ---------------------------------------------------------------------------
function hexToBytes(hex) {
    const out = [];
    for (let i = 0; i < hex.length; i += 2) {
        out.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
}
function bytesToBigInt(bytes) {
    return BigInt('0x' + bytes.toString('hex'));
}
function bigIntToBytes(n, byteLen) {
    const hex = n.toString(16).padStart(byteLen * 2, '0');
    return Buffer.from(hexToBytes(hex));
}
function sha256(data) {
    return (0, crypto_1.createHmac)('sha256', Buffer.alloc(0)).update(data).digest();
}
function sha256Hex(hexString) {
    return sha256(Buffer.from(hexToBytes(hexString))).toString('hex');
}
/** Modular exponentiation: (base^exp) % mod */
function modExp(base, exp, mod) {
    return base ** exp % mod;
}
/**
 * H(A || B) where A and B are left-padded to N_BYTES (256 bytes) before
 * concatenation and hashing.
 */
function hashAB(a, b) {
    const padA = Buffer.alloc(N_BYTES - a.length).fill(0);
    const padB = Buffer.alloc(N_BYTES - b.length).fill(0);
    return sha256(Buffer.concat([padA, a, padB, b]));
}
/** Random bigint in range [1, N-1] from cryptographically secure random bytes. */
function randomBigInt(byteLen) {
    const bytes = (0, crypto_1.randomBytes)(byteLen);
    const n = bytesToBigInt(bytes);
    const bigIntNMinus1 = BIGINT_N - BigInt(1);
    return (n % bigIntNMinus1) + BigInt(1);
}
// ---------------------------------------------------------------------------
// Pre-computed SRP constants (available at module load)
// ---------------------------------------------------------------------------
const BIGINT_G = BigInt('0x' + HEX_G);
const BIGINT_N = BigInt('0x' + HEX_N);
/** k = H(N || g) where N||g is the 257-byte concatenation of N (padded) and g */
const BIGINT_K = BigInt('0x' + sha256Hex(HEX_N + HEX_G));
// ---------------------------------------------------------------------------
// JWT helper (expiry-only, no signature verification needed)
// ---------------------------------------------------------------------------
function jwtExpiry(token) {
    try {
        const payload = token.split('.')[1];
        const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
        return JSON.parse(decoded).exp ?? 0;
    }
    catch {
        return 0;
    }
}
// ---------------------------------------------------------------------------
// Main auth class
// ---------------------------------------------------------------------------
class PentairAuth {
    constructor(username, password) {
        this.session = null;
        this.username = username;
        this.password = password;
        this.idpClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({ region: settings_1.AWS_REGION });
        this.identityClient = new client_cognito_identity_1.CognitoIdentityClient({ region: settings_1.AWS_REGION });
    }
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
    async getCredentials() {
        await this.refreshIfNeeded();
        if (!this.session) {
            throw new Error('PentairAuth: no session available after refresh attempt');
        }
        return this.session.credentials;
    }
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
    async fetchTokens() {
        const initiateResp = await this.idpClient.send(new client_cognito_identity_provider_1.InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: this.username,
                PASSWORD: this.password,
            },
            ClientId: settings_1.COGNITO_CLIENT_ID,
        }));
        if (!initiateResp.ChallengeName || initiateResp.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
            if (initiateResp.AuthenticationResult) {
                return {
                    idToken: initiateResp.AuthenticationResult.IdToken,
                    refreshToken: initiateResp.AuthenticationResult.RefreshToken,
                };
            }
            throw new Error('PentairAuth: unexpected response with no challenge and no tokens');
        }
        if (initiateResp.ChallengeName !== 'PASSWORD_VERIFIER') {
            throw new Error(`PentairAuth: unsupported challenge: ${initiateResp.ChallengeName}`);
        }
        if (!initiateResp.Session) {
            throw new Error('PentairAuth: PASSWORD_VERIFIER challenge missing session');
        }
        const { salt, srpB } = this.parseChallengeParams(initiateResp.ChallengeParameters);
        const { signature, timestamp } = this.computePasswordVerifierProof(salt, srpB);
        const challengeResp = await this.idpClient.send(new client_cognito_identity_provider_1.RespondToAuthChallengeCommand({
            ChallengeName: 'PASSWORD_VERIFIER',
            Session: initiateResp.Session,
            ClientId: settings_1.COGNITO_CLIENT_ID,
            ChallengeResponses: {
                PASSWORD_CLAIM_SIGNATURE: signature,
                PASSWORD_CLAIM_SECRET_BLOCK: initiateResp.ChallengeParameters.SECRET_BLOCK,
                TIMESTAMP: timestamp,
                USERNAME: this.username,
            },
        }));
        if (!challengeResp.AuthenticationResult) {
            throw new Error('PentairAuth: no AuthenticationResult after PASSWORD_VERIFIER challenge');
        }
        return {
            idToken: challengeResp.AuthenticationResult.IdToken,
            refreshToken: challengeResp.AuthenticationResult.RefreshToken,
        };
    }
    async refreshTokens(refreshToken) {
        const resp = await this.idpClient.send(new client_cognito_identity_provider_1.InitiateAuthCommand({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            AuthParameters: {
                REFRESH_TOKEN: refreshToken,
                USERNAME: this.username,
            },
            ClientId: settings_1.COGNITO_CLIENT_ID,
        }));
        if (!resp.AuthenticationResult) {
            throw new Error('PentairAuth: no AuthenticationResult from refresh');
        }
        return { idToken: resp.AuthenticationResult.IdToken };
    }
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
        if (!rawCreds?.AccessKeyId || !rawCreds.SecretKey || !rawCreds.SessionToken) {
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
    // ---------------------------------------------------------------------------
    // SRP challenge parameter parsing
    // ---------------------------------------------------------------------------
    parseChallengeParams(params) {
        const salt = Buffer.from(params.SALT, 'base64');
        const srpB = Buffer.from(params.SRP_B, 'base64');
        return { salt, srpB };
    }
    // ---------------------------------------------------------------------------
    // SRP-6a password proof (RFC 5054 compatible, pure Node.js crypto)
    //
    // Flow:
    //   x   = H(salt || H(USERNAME || ':' || PASSWORD))
    //   S   = (B - k·g^x) ^ (a + u·x)  mod N
    //   K   = H(S)                       (Cognito: first 16 bytes of H(S))
    //   M1  = H(A || B || K)             (client proof sent to server)
    // ---------------------------------------------------------------------------
    computePasswordVerifierProof(salt, srpB) {
        // x = H(salt || H(USERNAME || ':' || PASSWORD))
        const userPwdHash = sha256(Buffer.from(`${this.username}:${this.password}`, 'utf-8'));
        const x = bytesToBigInt(sha256(Buffer.concat([salt, userPwdHash])));
        // a = random ephemeral private value (256 bytes)
        const a = randomBigInt(N_BYTES);
        // A = g^a mod N  (padded to N_BYTES for SRP protocol)
        const A = modExp(BIGINT_G, a, BIGINT_N);
        const ABytes = bigIntToBytes(A, N_BYTES);
        // u = H(A || B)  (both padded to N_BYTES)
        const BBytes = Buffer.concat([
            Buffer.alloc(Math.max(0, N_BYTES - srpB.length), 0),
            srpB,
        ]);
        const u = bytesToBigInt(hashAB(ABytes, BBytes));
        // S = (B - k·g^x) ^ (a + u·x) mod N
        const gx = modExp(BIGINT_G, x, BIGINT_N);
        const kgx = (BIGINT_K * gx) % BIGINT_N;
        const BNum = bytesToBigInt(srpB.length >= N_BYTES ? srpB.slice(-N_BYTES) : srpB);
        const diff = (BNum + BIGINT_N - kgx) % BIGINT_N;
        const S = modExp(diff, a + u * x, BIGINT_N);
        // K = H(S) — first 16 bytes (Cognito-specific)
        const K = sha256(bigIntToBytes(S, N_BYTES)).slice(0, 16);
        // M1 = H(A || B || K)  (all values padded to N_BYTES)
        const M1 = Buffer.concat([hashAB(ABytes, bigIntToBytes(BNum, N_BYTES)), K]);
        const timestamp = new Date().toISOString();
        const signature = Buffer.concat([M1, Buffer.from(timestamp, 'utf-8')]).toString('base64');
        return { signature, timestamp };
    }
}
exports.PentairAuth = PentairAuth;
