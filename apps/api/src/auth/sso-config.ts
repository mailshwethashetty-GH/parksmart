/**
 * The identity provider from the environment (D2: Google Workspace or Microsoft Entra,
 * OIDC). Configured in env rather than registered through the API: production has no
 * other way to sign in, so the first admin could never register one (ADR-014).
 */
import type { Env } from '../config/env';

export type DefaultSso = {
  domain: string;
  providerId: string;
  oidcConfig: {
    issuer: string;
    discoveryEndpoint: string;
    clientId: string;
    clientSecret: string;
    pkce: boolean;
    scopes: string[];
  };
};

const SCOPES = ['openid', 'email', 'profile'];

export function ssoProvidersFromEnv(env: Env): DefaultSso[] {
  const domain = env.ORG_EMAIL_DOMAIN?.toLowerCase();
  if (!domain || !env.ssoProvider) return [];
  if (env.ssoProvider === 'google') {
    return [
      {
        domain,
        providerId: 'google',
        oidcConfig: {
          issuer: 'https://accounts.google.com',
          discoveryEndpoint: 'https://accounts.google.com/.well-known/openid-configuration',
          clientId: env.SSO_GOOGLE_CLIENT_ID!,
          clientSecret: env.SSO_GOOGLE_CLIENT_SECRET!,
          pkce: true,
          scopes: SCOPES,
        },
      },
    ];
  }
  const tenant = env.SSO_ENTRA_TENANT_ID!;
  return [
    {
      domain,
      providerId: 'entra',
      oidcConfig: {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        discoveryEndpoint: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`,
        clientId: env.SSO_ENTRA_CLIENT_ID!,
        clientSecret: env.SSO_ENTRA_CLIENT_SECRET!,
        pkce: true,
        scopes: SCOPES,
      },
    },
  ];
}

/**
 * Origins Better Auth must trust to use the provider's discovery document (it checks
 * the discovery URL and every endpoint the document lists). Only the configured IdP's.
 */
export function idpOrigins(env: Env): string[] {
  if (env.ssoProvider === 'google')
    return [
      'https://accounts.google.com',
      'https://oauth2.googleapis.com',
      'https://openidconnect.googleapis.com',
      'https://www.googleapis.com',
    ];
  if (env.ssoProvider === 'entra')
    return ['https://login.microsoftonline.com', 'https://graph.microsoft.com'];
  return [];
}

/** New users are employees, except the INITIAL_ADMIN_EMAILS (first sign-in only). */
export function roleForNewUser(env: Env, email: string): 'admin' | 'employee' {
  return env.initialAdminEmails.includes(email.toLowerCase()) ? 'admin' : 'employee';
}
