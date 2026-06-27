'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) { setError('Missing reset token.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Password reset</h1>
        <p className="text-sm text-muted-foreground mt-1">Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-foreground">Reset password</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose a new password for your account.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="rp-password" className="block text-xs font-semibold text-foreground mb-1.5">New Password</label>
          <input
            id="rp-password"
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            placeholder="At least 8 characters"
            className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label htmlFor="rp-confirm" className="block text-xs font-semibold text-foreground mb-1.5">Confirm Password</label>
          <input
            id="rp-confirm"
            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            placeholder="Re-enter new password"
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
          {loading ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
      <div className="mt-6 text-center">
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8">
        <Suspense fallback={<p className="text-center text-muted-foreground text-sm">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
