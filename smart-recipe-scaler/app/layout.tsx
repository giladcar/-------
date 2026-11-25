import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ממיר מתכונים חכם',
  description: 'התאמת כמויות, המרה לגרמים, החלפת רכיבים וטיימרים מותאמים אישית ללא AI',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
