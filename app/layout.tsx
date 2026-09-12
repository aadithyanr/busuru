import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'cycleuru — bengaluru, moving.',
  description: 'Watch Bengaluru try to move in real time.',
  openGraph: {
    title: 'cycleuru — bengaluru, moving.',
    description: 'Watch Bengaluru try to move in real time.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Cycleuru — Bengaluru, trying to move.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'cycleuru — bengaluru, moving.',
    description: 'Watch Bengaluru try to move in real time.',
    images: ['/og.png'],
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
