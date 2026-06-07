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
  title: 'C1X — Data Intelligence Platform',
  description: 'Query, visualize, and explore your data with AI-powered intelligence',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={outfit.variable}>
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
