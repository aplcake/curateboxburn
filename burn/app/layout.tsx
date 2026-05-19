import type { Metadata } from 'next';
import { Providers }     from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title:       'BURN',
  description: 'Token burn event',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ash-dark antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
