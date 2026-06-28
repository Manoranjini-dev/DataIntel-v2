'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { account } = await authApi.login(email, password);
      setUser(account);

      // Honor a deep-link the user was bounced from (set by middleware), else
      // route straight to the Dashboard — no org selection.
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      if (redirect && redirect.startsWith('/') && !redirect.startsWith('/login')) {
        router.replace(redirect);
      } else {
        router.replace('/dashboards');
      }
    } catch (err: any) {
      // Distinguish network errors from auth errors so the user knows
      // whether the problem is a wrong password or a server issue.
      const code = err?.code || err?.response?.code;
      const isNetwork = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
        || err?.message?.toLowerCase().includes('network error')
        || err?.message?.toLowerCase().includes('econnrefused');

      if (isNetwork) {
        setError('Cannot reach the server. Please wait a moment and try again.');
      } else {
        // Show the backend's message (e.g. "Invalid email or password") or
        // a friendly fallback.
        const msg = err?.response?.data?.message
          || err?.response?.data?.structured?.message
          || err?.message
          || 'Login failed. Please check your credentials.';
        setError(msg);
      }
      setLoading(false);
    }
  }

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
