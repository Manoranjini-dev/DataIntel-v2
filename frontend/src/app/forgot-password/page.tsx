'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8">
        {sent ? (
          <div className="text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-foreground">Check your email</h1>
            <p className="text-sm text-muted-foreground mt-1">
              If an account exists for that email, a reset link has been sent.
            </p>
            <Link href="/login" className="inline-block mt-6 text-primary text-sm font-semibold">Back to sign in</Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-foreground">Forgot password</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your email and we&apos;ll send a reset link.</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="fp-email" className="block text-xs font-semibold text-foreground mb-1.5">Email address</label>
                <input
                  id="fp-email"
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  placeholder="you@company.com"
                  className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {error && (
                <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full py-2.5 px-4 text-white font-semibold rounded-xl text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <div className="mt-6 text-center">
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
