'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Redirect /orgs/[slug] → /orgs/[slug]/dashboards
export default function OrgRoot() {
  const { slug } = useParams<{ slug: string }>();
  const router   = useRouter();

  useEffect(() => {
    if (slug) router.replace(`/orgs/${slug}/dashboards`);
  }, [slug, router]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
