export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}
export declare class PentairAuth {
    private readonly username;
    private readonly password;
    private session;
    private readonly srpClient;
    private readonly identityClient;
    constructor(username: string, password: string);
    authenticate(): Promise<void>;
    refreshIfNeeded(): Promise<void>;
    getCredentials(): Promise<AwsCredentials>;
    getIdToken(): Promise<string>;
    private fetchTokens;
    private refreshTokens;
    private fetchCredentials;
}
