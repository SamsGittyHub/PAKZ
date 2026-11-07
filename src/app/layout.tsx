import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Analytics } from "@/components/analytics/Analytics";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";

export const metadata: Metadata = {
  title: "PAKZ",
  description: "Curated resale streetwear and sneakers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Suspense fallback={null}>
          <Analytics />
          <ConsentBanner />
        </Suspense>
      </body>
    </html>
  );
}
