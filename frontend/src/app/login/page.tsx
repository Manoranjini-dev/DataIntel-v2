'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi, ssoApi, type PublicSsoProvider } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── SSO ──
  const [providers, setProviders] = useState<PublicSsoProvider[]>([]);
  const [ldapOpen, setLdapOpen] = useState(false);
  const [ldapUser, setLdapUser] = useState('');
  const [ldapPass, setLdapPass] = useState('');
  const [ldapLoading, setLdapLoading] = useState(false);

  useEffect(() => {
    // Surface an error passed back from an SSO redirect callback.
    const ssoError = new URLSearchParams(window.location.search).get('sso_error');
    if (ssoError) {
      // Map backend error messages to friendly, actionable UI text.
      const lower = ssoError.toLowerCase();
      if (lower.includes('not been set up') || lower.includes('no account') || lower.includes('not provisioned')) {
        setError('Your Google account is not registered with this application. Please contact your administrator to get access.');
      } else if (lower.includes('deactivated') || lower.includes('not active') || lower.includes('access denied')) {
        setError('Your account has been deactivated. Please contact your administrator to restore access.');
      } else if (lower.includes('domain') && lower.includes('not permitted')) {
        setError('Your email domain is not allowed for this application. Contact your administrator.');
      } else if (lower.includes('no longer exists')) {
        setError('This account no longer exists. Contact your administrator.');
      } else {
        // Unknown SSO error — show a generic but actionable message.
        setError('Google sign-in failed. If you need access, ask your administrator to invite you.');
      }
    }
    // Load which SSO providers the admin has enabled (used for LDAP).
    ssoApi.providers().then((r) => setProviders(r.providers || [])).catch(() => {});
  }, []);

  function afterLogin() {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect && redirect !== '/' && redirect.startsWith('/') && !redirect.startsWith('/login')) {
      router.replace(redirect);
    } else {
      router.replace('/dashboards');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { account } = await authApi.login(email, password);
      setUser(account);
      afterLogin();
    } catch (err: any) {
      const code = err?.code || err?.response?.code;
      const isNetwork = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
        || err?.message?.toLowerCase().includes('network error')
        || err?.message?.toLowerCase().includes('econnrefused');
      if (isNetwork) {
        setError('Cannot reach the server. Please wait a moment and try again.');
      } else {
        const msg = err?.response?.data?.message
          || err?.response?.data?.structured?.message
          || err?.structured?.message
          || err?.message
          || 'Login failed. Please check your credentials.';
        setError(msg);
      }
      setLoading(false);
    }
  }

  async function handleLdap(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLdapLoading(true);
    try {
      const { account } = await ssoApi.ldapLogin(ldapUser, ldapPass);
      setUser(account);
      afterLogin();
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'Directory sign-in failed.');
      setLdapLoading(false);
    }
  }

  const ldapProvider = (providers || []).find((p) => p.kind === 'password');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/image.png" alt="C1X Logo" style={{ height: 44, width: 'auto', objectFit: 'contain' }} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your workspace to continue</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-8"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            <div className="text-right -mt-2">
              <Link href="/forgot-password" className="text-xs text-primary hover:opacity-80 font-medium">
                Forgot password?
              </Link>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-white font-semibold rounded-xl transition-all duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          {/* ── SSO Section ── */}
          <div className="mt-6">
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border" />
              <span className="mx-3 text-xs text-muted-foreground">or continue with</span>
              <div className="flex-grow border-t border-border" />
            </div>

            {/* Google + Microsoft always visible per SSO-01 & SSO-02 */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {/* Google Workspace (SSO-01) */}
              <button
                type="button"
                id="sso-google-btn"
                onClick={() => { window.location.href = ssoApi.startUrl('google'); }}
                className="flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-border bg-card hover:bg-muted/60 text-foreground font-medium text-sm transition-all duration-150 hover:shadow-sm active:scale-[0.98]"
              >
                {/* Official Google "G" SVG */}
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M17.64 9.2045C17.64 8.5663 17.5827 7.9527 17.4764 7.3636H9V10.845H13.8436C13.635 11.97 13.0009 12.9231 12.0477 13.5613V15.8195H14.9564C16.6582 14.2527 17.64 11.9454 17.64 9.2045Z" fill="#4285F4"/>
                  <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5613C11.2418 14.1013 10.2109 14.4204 9 14.4204C6.65591 14.4204 4.67182 12.8372 3.96409 10.71H0.957275V13.0418C2.43818 15.9831 5.48182 18 9 18Z" fill="#34A853"/>
                  <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.5931 3.68182 9C3.68182 8.4069 3.78409 7.83 3.96409 7.29V4.9582H0.957275C0.347727 6.1731 0 7.5477 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
                  <path d="M9 3.5795C10.3214 3.5795 11.5077 4.0336 12.4405 4.9254L15.0218 2.344C13.4632 0.8918 11.4259 0 9 0C5.48182 0 2.43818 2.0168 0.957275 4.9582L3.96409 7.29C4.67182 5.1627 6.65591 3.5795 9 3.5795Z" fill="#EA4335"/>
                </svg>
                Google
              </button>

              {/* Microsoft Entra ID (SSO-02) */}
              <button
                type="button"
                id="sso-microsoft-btn"
                onClick={() => { window.location.href = ssoApi.startUrl('entra'); }}
                className="flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-border bg-card hover:bg-muted/60 text-foreground font-medium text-sm transition-all duration-150 hover:shadow-sm active:scale-[0.98]"
              >
                {/* Official Microsoft four-square SVG */}
                <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                </svg>
                Microsoft
              </button>
            </div>

            {/* LDAP / Active Directory — only shown when admin-enabled (SSO-03) */}
            {ldapProvider && !ldapOpen && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setLdapOpen(true)}
                  className="w-full py-2.5 px-4 rounded-xl border border-border bg-muted/40 hover:bg-muted text-foreground font-medium text-sm transition-all"
                >
                  Continue with {ldapProvider.displayName}
                </button>
              </div>
            )}

            {ldapProvider && ldapOpen && (
              <form onSubmit={handleLdap} className="mt-4 space-y-3 border-t border-border pt-4">
                <p className="text-xs font-semibold text-foreground">{ldapProvider.displayName} sign-in</p>
                <input
                  type="text"
                  value={ldapUser}
                  onChange={(e) => setLdapUser(e.target.value)}
                  required
                  placeholder="Username"
                  className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <input
                  type="password"
                  value={ldapPass}
                  onChange={(e) => setLdapPass(e.target.value)}
                  required
                  placeholder="Password"
                  className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="submit"
                  disabled={ldapLoading}
                  className="w-full py-2.5 px-4 rounded-xl border border-border bg-foreground text-background font-medium text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {ldapLoading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Need access? Ask your administrator to send you an invitation.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
