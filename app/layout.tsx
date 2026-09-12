import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'cycleuru — bengaluru, moving.',
  description: 'Watch Bengaluru try to move in real time.',
  openGraph: {
    title: 'cycleuru — bengaluru, moving.',
    description: 'Watch Bengaluru try to move in real time.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'cycleuru — bengaluru, moving.',
    description: 'Watch Bengaluru try to move in real time.',
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
