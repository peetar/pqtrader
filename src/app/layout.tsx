import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PQ Trader — Project Quarm Auction Intelligence & Bazaar Manager',
  description:
    'Project Quarm EverQuest WTS / WTB / WTT market explorer, PoP spell & parchment trade tracker, Discord channel parser, and TAKP Inventory.txt + BZR_*.ini manager.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
