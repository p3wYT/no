import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "RepostFlow — Automated cross-platform publishing",
  description:
    "Connect TikTok, Instagram and YouTube, detect new videos and cross-post automatically with powerful scheduling and caption rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Apply persisted theme before paint to avoid flash.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('rf-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans`}>{children}</body>
    </html>
  );
}
