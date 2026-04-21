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

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
  Credentials as CognitoCredentials,
} from '@aws-sdk/client-cognito-identity';
import {
  AWS_REGION,
  COGNITO_CLIENT_ID,
  COGNITO_IDENTITY_POOL_ID,
  COGNITO_LOGIN_KEY,
  COGNITO_USER_POOL_ID,
} from './settings';

/** AWS credential set returned by Cognito Identity Pool. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/** Internal representation of a fully authenticated Pentair session. */
interface AuthSession {
  idToken: string;
  refreshToken: string;
  /** Unix epoch (seconds) when the ID token expires. */
  idTokenExpiry: number;
  credentials: AwsCredentials;
  /** Unix epoch (seconds) when the STS credentials expire. */
  credentialsExpiry: number;
}

/**
 * Parses the expiration time from a JWT without verifying the signature.
 * Returns a Unix epoch in seconds, or 0 on parse failure.
 */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as { exp?: number };
    return parsed.exp ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Manages Pentair Cloud authentication using AWS Cognito SRP auth.
 */
export class PentairAuth {
  private readonly username: string;
  private readonly password: string;
  private session: AuthSession | null = null;

  private readonly userPool: CognitoUserPool;
  private readonly identityClient: CognitoIdentityClient;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;

    this.userPool = new CognitoUserPool({
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    });

    this.identityClient = new CognitoIdentityClient({
      region: AWS_REGION,
    });
  }

  /**
   * Performs the full two-step authentication:
   *  1. SRP auth → ID token + refresh token
   *  2. Cognito Identity Pool → temporary AWS credentials
   */
  async authenticate(): Promise<void> {
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
  async refreshIfNeeded(): Promise<void> {
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
    } catch {
      await this.authenticate();
    }
  }

  /**
   * Returns the current AWS credentials, refreshing them first if necessary.
   */
  async getCredentials(): Promise<AwsCredentials> {
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
  async getIdToken(): Promise<string> {
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
  private fetchTokens(): Promise<{ idToken: string; refreshToken: string }> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: this.username,
        Pool: this.userPool,
      });

      cognitoUser.authenticateUser(
        new AuthenticationDetails({
          Username: this.username,
          Password: this.password,
        }),
        {
          onSuccess: (session: CognitoUserSession) => {
            resolve({
              idToken: session.getIdToken().getJwtToken(),
              refreshToken: session.getRefreshToken().getToken(),
            });
          },
          onFailure: reject,
        },
      );
    });
  }

  /**
   * Refreshes the session using the stored refresh token.
   */
  private refreshTokens(refreshToken: string): Promise<{ idToken: string }> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: this.username,
        Pool: this.userPool,
      });

      cognitoUser.refreshSession(
        new CognitoRefreshToken({ RefreshToken: refreshToken }),
        (err, session: CognitoUserSession) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ idToken: session.getIdToken().getJwtToken() });
        },
      );
    });
  }

  /**
   * Exchanges a Cognito ID token for temporary AWS credentials via the
   * Identity Pool.
   */
  private async fetchCredentials(
    idToken: string,
  ): Promise<{ credentials: AwsCredentials; expiry: number }> {
    const getIdResponse = await this.identityClient.send(
      new GetIdCommand({
        IdentityPoolId: COGNITO_IDENTITY_POOL_ID,
        Logins: {
          [COGNITO_LOGIN_KEY]: idToken,
        },
      }),
    );

    const identityId = getIdResponse.IdentityId;
    if (!identityId) {
      throw new Error('PentairAuth: GetId returned no IdentityId');
    }

    const credsResponse = await this.identityClient.send(
      new GetCredentialsForIdentityCommand({
        IdentityId: identityId,
        Logins: {
          [COGNITO_LOGIN_KEY]: idToken,
        },
      }),
    );

    const rawCreds: CognitoCredentials | undefined = credsResponse.Credentials;
    if (
      !rawCreds?.AccessKeyId ||
      !rawCreds.SecretKey ||
      !rawCreds.SessionToken
    ) {
      throw new Error(
        'PentairAuth: GetCredentialsForIdentity returned incomplete credentials',
      );
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
