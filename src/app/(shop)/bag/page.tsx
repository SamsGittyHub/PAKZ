import type { Metadata } from "next";
import { Suspense } from "react";
import { BagView } from "@/components/shop/BagView";

export const metadata: Metadata = { title: "Bag", robots: { index: false } };

export default function BagPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
      <h1 className="shop-display mb-8 text-5xl sm:text-7xl">Your bag</h1>
      <Suspense fallback={null}><BagView /></Suspense>
    </div>
  );
}
