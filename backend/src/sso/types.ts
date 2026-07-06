// ──────────────────────────────────────────────
// SSO — shared types
// ──────────────────────────────────────────────

import { PlatformRole } from '../auth/auth.service';

/** Supported external identity providers. */
export type SsoProvider = 'google' | 'entra' | 'ldap';

export const SSO_PROVIDERS: readonly SsoProvider[] = ['google', 'entra', 'ldap'] as const;

/** Redirect-based (OIDC) providers. LDAP is form/credential based. */
export const OIDC_PROVIDERS: readonly SsoProvider[] = ['google', 'entra'] as const;

export function isSsoProvider(v: string): v is SsoProvider {
  return (SSO_PROVIDERS as readonly string[]).includes(v);
}

/** Row as stored in `sso_providers`. */
export interface SsoProviderRow {
  provider: SsoProvider;
  enabled: boolean;
  display_name: string | null;
  config: Record<string, any>;
  encrypted_secret: string | null;
  auto_provision: boolean;
  allowed_domains: string[];
  default_role: PlatformRole;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Public projection returned to the (unauthenticated) login page. */
export interface PublicSsoProvider {
  provider: SsoProvider;
  displayName: string;
  /** 'redirect' → start an OIDC flow; 'password' → LDAP username/password form. */
  kind: 'redirect' | 'password';
}

/** Admin projection — full config with the secret redacted. */
export interface AdminSsoProvider {
  provider: SsoProvider;
  enabled: boolean;
  displayName: string | null;
  config: Record<string, any>;
  hasSecret: boolean;
  autoProvision: boolean;
  allowedDomains: string[];
  defaultRole: PlatformRole;
  updatedBy: string | null;
  updatedAt: string;
}

/** Normalized identity returned by any provider after successful auth. */
export interface ExternalProfile {
  /** Stable, provider-unique subject identifier. */
  subject: string;
  email: string | null;
  displayName: string | null;
}

/** Short-lived OIDC transaction state, encrypted into a cookie between start/callback. */
export interface OidcTransaction {
  provider: SsoProvider;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string;
}
