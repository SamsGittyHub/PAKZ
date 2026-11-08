import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Analytics } from "@/components/analytics/Analytics";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "PAKZ — authenticated resale sneakers & streetwear", template: "%s · PAKZ" },
  description: "Authenticated resale sneakers and streetwear. Rare pairs, real ones.",
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
