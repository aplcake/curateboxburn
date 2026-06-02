import type { Metadata } from 'next';
import { Providers }     from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title:       'BURN — Museum of Based',
  description: 'Token burn event on Base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* bg matches the 3D room's background so loader transition is seamless */}
      <body style={{ background: '#aec9bf', overflow: 'hidden', margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
