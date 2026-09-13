import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://busuru.aadithyanr.dev').replace(
  /\/$/,
  '',
);
const title = 'busuru — Bengaluru’s buses, moving';
const description = 'Watch Bengaluru’s scheduled BMTC buses move through the city.';
const socialImageUrl = `${siteUrl}/og.png?v=1`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: siteUrl },
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title,
    description,
    type: 'website',
    url: siteUrl,
    siteName: 'busuru',
    images: [
      {
        url: socialImageUrl,
        width: 1200,
        height: 630,
        alt: 'busuru — Bengaluru’s buses, moving',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [socialImageUrl],
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
