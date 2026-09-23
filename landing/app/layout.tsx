import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const siteUrl = 'https://schrodrive.org';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'SchröDrive — The Ultimate Media Automation Orchestrator',
    template: '%s | SchröDrive',
  },
  description:
    'Your content exists everywhere and nowhere — until SchröDrive observes it. Open-source media automation for Plex, Jellyfin & Emby with 11 debrid providers, Prowlarr/Jackett, and a fake qBittorrent bridge for Sonarr/Radarr.',
  keywords: [
    'plex debrid',
    'realdebrid alternative',
    'torbox plex',
    'sonarr download client',
    'radarr qBittorrent',
    'rclone webdav bridge',
    'prowlarr jackett',
    'overseerr seerr',
    'jellyfin debrid',
    'plex realdebrid without downloading',
    'selfhosted media automation',
    'schrodrive',
  ],
  authors: [{ name: 'SchröDrive', url: siteUrl }],
  creator: 'SchröDrive',
  publisher: 'SchröDrive',
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: 'SchröDrive — The Ultimate Media Automation Orchestrator',
    description:
      'Open-source Plex/Jellyfin media automation with 11 debrid providers, Prowlarr/Jackett, and a fake qBittorrent bridge for Sonarr/Radarr. One container.',
    url: siteUrl,
    siteName: 'SchröDrive',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'SchröDrive — Your content exists everywhere and nowhere',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SchröDrive — The Ultimate Media Automation Orchestrator',
    description: '11 debrid providers, Prowlarr/Jackett, Plex/Jellyfin, and a fake qBittorrent bridge — one container.',
    images: ['/og.png'],
    creator: '@moderniselife',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    // add google: 'your-google-verification' when Search Console is set up
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#030014] text-white font-sans">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
