'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api';

function ActivateForm() {
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
    if (!token) { setError('Missing activation token.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    try {
      // Reuses the existing invitation-token activation. The backend validates
      // the token (invalid / expired / already-used all return an error) and
      // sets the password — it does NOT log the user in.
      await authApi.activateAccount(token, password);
      setDone(true);
      setTimeout(() => router.push('/login'), 1800);
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'This invitation link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  }

  // Token must be present before we allow password setup.
  if (!token) {
    return (
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Invalid activation link</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This link is missing its invitation token. Please use the link from your invitation email.
        </p>
        <Link href="/login" className="inline-block mt-6 text-primary text-sm font-semibold">Back to sign in</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Password set successfully. Please login.</h1>
        <p className="text-sm text-muted-foreground mt-1">Redirecting you to the sign-in page…</p>
        <Link
          href="/login"
          className="inline-block mt-6 px-5 py-2.5 text-white font-semibold rounded-xl text-sm"
          style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
        >
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-foreground">Activate your account</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose a password to finish setting up.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="act-password" className="block text-xs font-semibold text-foreground mb-1.5">Password</label>
          <input
            id="act-password"
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            placeholder="At least 8 characters"
            className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label htmlFor="act-confirm" className="block text-xs font-semibold text-foreground mb-1.5">Confirm Password</label>
          <input
            id="act-confirm"
            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            placeholder="Re-enter password"
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
          {loading ? 'Activating…' : 'Activate account'}
        </button>
      </form>
    </>
  );
}

export default function ActivatePage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8">
        <Suspense fallback={<p className="text-center text-muted-foreground text-sm">Loading…</p>}>
          <ActivateForm />
        </Suspense>
      </div>
    </div>
  );
}
