'use client';

import Link from 'next/link';
import { Mail } from 'lucide-react';

// Self-registration is disabled. Accounts are created by an administrator
// via invitation (see Admin → User Management). This page is kept so any
// existing links resolve to a clear explanation rather than a 404.
export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <Mail className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Registration is by invitation</h1>
        <p className="text-sm text-muted-foreground mt-2">
          New accounts are created by an administrator. If you&apos;re expecting access,
          check your email for an invitation link, or contact your administrator.
        </p>
        <Link
          href="/login"
          className="inline-block mt-6 px-5 py-2.5 text-white font-semibold rounded-xl text-sm"
          style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
