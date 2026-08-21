import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { Providers } from './providers';
import { Header } from '@/components/layout/Header';
import './globals.css';

/**
 * The type pairing. Fraunces is variable, so the optical-size and softness axes
 * can be tuned in CSS rather than shipping several static cuts; Inter carries
 * the interface text and the tabular figures money depends on.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Reneo',
  description: 'Multi-seller commerce',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
