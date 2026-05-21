"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairAuth = void 0;
const crypto_1 = require("crypto");
const client_cognito_identity_1 = require("@aws-sdk/client-cognito-identity");
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const settings_1 = require("./settings");
// ---------------------------------------------------------------------------
// SRP-6a constants – NIST 2048-bit safe prime group (RFC 5054)
// ---------------------------------------------------------------------------
/** N: 2048-bit safe prime (hex, 512 chars = 256 bytes) per RFC 5054 */
const HEX_N = 'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329C' +
    'BB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50E8083969EDB767B' +
    '0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740' +
    'ADBF4FF747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6' +
    '481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D5EA77A2775D2ECFA032C' +
    'FBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D' +
    '0C38271AE35F8E9DBFBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA' +
    '7111F9E4AFF73';
/** g: generator = 2 */
const HEX_G = '02';
/** Byte length of N used for the random ephemeral private key. */
const N_BYTES = 256;
// Verify HEX_N is exactly 512 hex chars (256 bytes) at module load time.
// A single character error in these constants would silently break SRP entirely.
if (HEX_N.length !== 512) {
    throw new Error(`auth: HEX_N must be 512 hex chars (256 bytes), got ${HEX_N.length}`);
}
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
function sha256(data) {
    return (0, crypto_1.createHash)('sha256').update(data).digest();
}
/**
 * Pad a bigint to a minimal even-length two's-complement hex string.
 * Matches the padHex() used by amazon-cognito-identity-js so that k, u, and
 * HKDF inputs agree with what Cognito's server-side SRP implementation expects.
 */
function padHex(n) {
    let hex = n.toString(16);
    if (hex.length % 2 !== 0)
        hex = '0' + hex;
    if ('89abcdef'.includes(hex[0]))
        hex = '00' + hex;
    return hex;
}
/** Square-and-multiply modular exponentiation — required for 2048-bit SRP values. */
function modExp(base, exp, mod) {
    let result = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp & 1n)
            result = (result * base) % mod;
        exp >>= 1n;
        base = (base * base) % mod;
    }
    return result;
}
/** Random bigint in range [1, N-1] from cryptographically secure random bytes. */
function randomBigInt(byteLen) {
    const bytes = (0, crypto_1.randomBytes)(byteLen);
    const n = bytesToBigInt(bytes);
    const bigIntNMinus1 = BIGINT_N - 1n;
    return (n % bigIntNMinus1) + 1n;
}
// ---------------------------------------------------------------------------
// Pre-computed SRP constants (available at module load)
// ---------------------------------------------------------------------------
const BIGINT_G = BigInt('0x' + HEX_G);
const BIGINT_N = BigInt('0x' + HEX_N);
/**
 * k = H(N_hex || g_hex) where N_hex is the raw 512-char constant and g_hex = "02".
 * Matches amazon-cognito-identity-js: N.toString(16)+"2" → 513-char hex → 257 bytes
 * (Math.ceil(513/2)), last byte = 0x02. Identical to bytes_of(HEX_N + HEX_G).
 * Using padHex(N) would prepend an extra 0x00 byte and produce a different hash.
 */
const BIGINT_K = bytesToBigInt(sha256(Buffer.from(hexToBytes(HEX_N + HEX_G))));
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
// Cognito timestamp (must match Cognito's expected format exactly)
// ---------------------------------------------------------------------------
const UTC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UTC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function cognitoTimestamp() {
    const now = new Date();
    const timeStr = now.toUTCString().split(' ')[4]; // "HH:mm:ss"
    return `${UTC_DAYS[now.getUTCDay()]} ${UTC_MONTHS[now.getUTCMonth()]} ${now.getUTCDate()} ${timeStr} UTC ${now.getUTCFullYear()}`;
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
        // Generate the ephemeral SRP keypair up front — A must be sent in InitiateAuth
        // and the same private key a must later be used to compute the proof.
        const a = randomBigInt(N_BYTES);
        const A = modExp(BIGINT_G, a, BIGINT_N);
        const initiateResp = await this.idpClient.send(new client_cognito_identity_provider_1.InitiateAuthCommand({
            AuthFlow: 'USER_SRP_AUTH',
            AuthParameters: {
                USERNAME: this.username,
                SRP_A: A.toString(16),
            },
            ClientId: settings_1.COGNITO_CLIENT_ID,
        }));
        if (initiateResp.ChallengeName !== 'PASSWORD_VERIFIER') {
            if (initiateResp.AuthenticationResult) {
                return {
                    idToken: initiateResp.AuthenticationResult.IdToken,
                    refreshToken: initiateResp.AuthenticationResult.RefreshToken,
                };
            }
            throw new Error(`PentairAuth: unexpected challenge: ${initiateResp.ChallengeName ?? 'none'}`);
        }
        const params = initiateResp.ChallengeParameters;
        // SALT and SRP_B arrive as hex strings from Cognito, not base64.
        const saltHex = params.SALT;
        const srpBHex = params.SRP_B;
        const secretBlock = params.SECRET_BLOCK;
        // USER_ID_FOR_SRP is the canonical username Cognito used for verifier lookup;
        // may differ from this.username when signing in with an email/phone alias.
        const userId = params.USER_ID_FOR_SRP ?? this.username;
        const { signature, timestamp } = this.computePasswordVerifierProof(a, A, saltHex, srpBHex, secretBlock, userId);
        const challengeResp = await this.idpClient.send(new client_cognito_identity_provider_1.RespondToAuthChallengeCommand({
            ChallengeName: 'PASSWORD_VERIFIER',
            Session: initiateResp.Session,
            ClientId: settings_1.COGNITO_CLIENT_ID,
            ChallengeResponses: {
                PASSWORD_CLAIM_SIGNATURE: signature,
                PASSWORD_CLAIM_SECRET_BLOCK: secretBlock,
                TIMESTAMP: timestamp,
                USERNAME: userId,
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
    // SRP-6a password proof (Cognito-specific, NOT standard RFC 5054 M1)
    //
    // Cognito's server validates:
    //   u   = H(padHex(A) || padHex(B))
    //   x   = H(salt || H(pool_name + userId + ':' + password))
    //   S   = (B - k·g^x) ^ (a + u·x)  mod N
    //   K   = HKDF(ikm=padHex(S), salt=padHex(u), info='Caldera Derived Key\x01')[:16]
    //   sig = base64(HMAC-SHA256(K, pool_name || userId || secret_block || timestamp))
    //
    // All padHex() calls use minimal two's-complement zero-padding, matching
    // amazon-cognito-identity-js so that both sides agree on the bit representation.
    // ---------------------------------------------------------------------------
    computePasswordVerifierProof(a, A, saltHex, srpBHex, secretBlock, userId) {
        const poolName = settings_1.COGNITO_USER_POOL_ID.split('_')[1];
        const BNum = BigInt('0x' + srpBHex);
        // u = H(padHex(A) || padHex(B))  — matches amazon-cognito-identity-js hexHash(padHex(A)+padHex(B))
        const u = bytesToBigInt(sha256(Buffer.from(hexToBytes(padHex(A) + padHex(BNum)))));
        // x = H(padHex(salt) || H_hex(pool_name + userId + ':' + password))
        // amazon-cognito-identity-js: hexHash(padHex(salt_bigint) + sha256_hex(poolName+userId+':'+pw))
        // padHex(salt) adds a leading 0x00 byte when salt's MSB nibble >= 8 (~50% of calls).
        // The inner hash is concatenated as its 64-char hex string, then the whole thing
        // is decoded from hex to bytes before the outer SHA256.
        const innerHashHex = sha256(Buffer.from(`${poolName}${userId}:${this.password}`, 'utf-8')).toString('hex');
        const x = bytesToBigInt(sha256(Buffer.from(hexToBytes(padHex(BigInt('0x' + saltHex)) + innerHashHex))));
        // S = (B - k·g^x)^(a + u·x) mod N
        const gx = modExp(BIGINT_G, x, BIGINT_N);
        const kgx = (BIGINT_K * gx) % BIGINT_N;
        const diff = (BNum + BIGINT_N - kgx) % BIGINT_N;
        const S = modExp(diff, a + u * x, BIGINT_N);
        // K via simplified 2-round HKDF matching amazon-cognito-identity-js:
        //   prk = HMAC-SHA256(key=padHex(u), data=padHex(S))
        //   K   = HMAC-SHA256(key=prk, data=info)[:16]
        const SBytes = Buffer.from(hexToBytes(padHex(S)));
        const uBytes = Buffer.from(hexToBytes(padHex(u)));
        const prk = (0, crypto_1.createHmac)('sha256', uBytes).update(SBytes).digest();
        const info = Buffer.concat([
            Buffer.from('Caldera Derived Key', 'utf-8'),
            Buffer.from([0x01]),
        ]);
        const K = (0, crypto_1.createHmac)('sha256', prk).update(info).digest().slice(0, 16);
        const timestamp = cognitoTimestamp();
        // sig = base64(HMAC-SHA256(K, pool_name || userId || secret_block_bytes || timestamp))
        const msg = Buffer.concat([
            Buffer.from(poolName, 'utf-8'),
            Buffer.from(userId, 'utf-8'),
            Buffer.from(secretBlock, 'base64'),
            Buffer.from(timestamp, 'utf-8'),
        ]);
        const signature = (0, crypto_1.createHmac)('sha256', K).update(msg).digest('base64');
        return { signature, timestamp };
    }
}
exports.PentairAuth = PentairAuth;
