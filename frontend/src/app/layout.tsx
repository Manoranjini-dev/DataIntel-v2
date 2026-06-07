import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';

import { QueryProvider } from '../providers/query-provider';
import { AppShell } from '../components/layout/AppShell';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'DataIntel — SQL Intelligence Platform',
  description: 'Conversational SQL intelligence with validated, safe query execution',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${outfit.variable}`}>
      <body className="font-sans antialiased">
        <QueryProvider>
          <AppShell>
            {children}
          </AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
