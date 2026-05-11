export type AuthProviderName = 'google' | 'apple';

export type AuthTransactionPurpose = 'sign-in' | 'link';

export type OAuthIdentity = {
  provider: AuthProviderName;
  providerSubjectId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};

export type OAuthProviderAdapter = {
  provider: AuthProviderName;
  buildAuthorizationUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthIdentity>;
};
