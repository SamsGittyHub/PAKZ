import Link from "next/link";

// Storefront placeholder. The storefront calls `track()` from "@/lib/track/client" for
// product_view / search / filter_used / add_to_cart / checkout_started etc. (see docs/ANALYTICS.md).
export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">PAKZ</h1>
        <p className="muted mt-2 text-sm">Storefront goes here.</p>
        <Link href="/admin" className="btn mt-6">Admin dashboard →</Link>
      </div>
    </main>
  );
}
