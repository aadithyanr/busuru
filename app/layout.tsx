import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'busuru — Bengaluru’s buses, moving',
  description: 'Watch Bengaluru’s scheduled BMTC buses move through the city.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'busuru — Bengaluru’s buses, moving',
    description: 'Watch Bengaluru’s scheduled BMTC buses move through the city.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'busuru — Bengaluru’s buses, moving',
    description: 'Watch Bengaluru’s scheduled BMTC buses move through the city.',
  },
};

export const viewport: Viewport = {
  themeColor: '#08090b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
