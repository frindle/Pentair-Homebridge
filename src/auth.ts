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

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
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
 * Manages Pentair Cloud authentication using AWS Cognito.
 *
 * Usage:
 * ```ts
 * const auth = new PentairAuth('user@example.com', 'password');
 * await auth.authenticate();
 * const creds = await auth.getCredentials();
 * ```
 */
export class PentairAuth {
  private readonly username: string;
  private readonly password: string;
  private session: AuthSession | null = null;

  private readonly userPoolClient: CognitoIdentityProviderClient;
  private readonly identityClient: CognitoIdentityClient;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;

    this.userPoolClient = new CognitoIdentityProviderClient({
      region: AWS_REGION,
    });

    this.identityClient = new CognitoIdentityClient({
      region: AWS_REGION,
    });
  }

  /**
   * Performs the full two-step authentication:
   *  1. USER_PASSWORD_AUTH → ID token + refresh token
   *  2. Cognito Identity Pool → temporary AWS credentials
   *
   * @throws {Error} if Cognito returns no authentication result or tokens.
   */
  async authenticate(): Promise<void> {
    const { idToken, refreshToken } = await this.fetchTokens();
    const credentials = await this.fetchCredentials(idToken);

    this.session = {
      idToken,
      refreshToken,
      idTokenExpiry: jwtExpiry(idToken),
      credentials,
      credentialsExpiry: jwtExpiry(idToken), // creds expire ~= ID token expiry
    };
  }

  /**
   * Refreshes credentials if the ID token will expire within the next 5 minutes.
   * Silently no-ops when the session is still fresh.
   *
   * @throws {Error} if refresh fails and no valid session exists.
   */
  async refreshIfNeeded(): Promise<void> {
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
      const credentials = await this.fetchCredentials(refreshed.idToken);

      this.session = {
        idToken: refreshed.idToken,
        // Refresh token may or may not be rotated; keep old one if not returned.
        refreshToken: refreshed.refreshToken ?? this.session.refreshToken,
        idTokenExpiry: jwtExpiry(refreshed.idToken),
        credentials,
        credentialsExpiry: jwtExpiry(refreshed.idToken),
      };
    } catch {
      // Fall back to full re-authentication with username/password.
      await this.authenticate();
    }
  }

  /**
   * Returns the current AWS credentials, refreshing them first if necessary.
   *
   * @returns Temporary AWS credentials for SigV4 signing.
   */
  async getCredentials(): Promise<AwsCredentials> {
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
  private async fetchTokens(): Promise<{ idToken: string; refreshToken: string }> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: this.username,
        PASSWORD: this.password,
      },
    });

    const response: InitiateAuthCommandOutput =
      await this.userPoolClient.send(command);

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
  private async refreshTokens(
    refreshToken: string,
  ): Promise<{ idToken: string; refreshToken?: string }> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const response: InitiateAuthCommandOutput =
      await this.userPoolClient.send(command);

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
   * @returns Temporary AWS credentials.
   */
  private async fetchCredentials(idToken: string): Promise<AwsCredentials> {
    // Step 1: resolve the Identity Pool identity ID for this user.
    const getIdResponse = await this.identityClient.send(
      new GetIdCommand({
        AccountId: COGNITO_IDENTITY_POOL_ID.split(':')[0], // AWS account not needed but API accepts it
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

    // Step 2: exchange the identity ID + ID token for STS credentials.
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

    return {
      accessKeyId: rawCreds.AccessKeyId,
      secretAccessKey: rawCreds.SecretKey,
      sessionToken: rawCreds.SessionToken,
    };
  }
}
