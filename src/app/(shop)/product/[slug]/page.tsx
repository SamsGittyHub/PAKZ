import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShieldCheck, Truck } from "lucide-react";
import { getCatalog, getProduct } from "@/lib/shop/catalog";
import { ProductGrid, conditionLabel } from "@/components/shop/ProductCard";
import { Gallery } from "@/components/shop/Gallery";
import { BuyBox } from "@/components/shop/BuyBox";
import { TrackProductView } from "@/components/shop/Tracking";
import { STORE_NAME } from "@/lib/shop/config";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  await connection();
  const p = await getProduct(slug);
  if (!p) return { title: "Not found" };
  const title = p.seoTitle || `${p.brand ? `${p.brand} ` : ""}${p.title}`.trim();
  const description = p.seoDescription || p.description?.slice(0, 160) || `${p.title} — ${conditionLabel(p.variants[0]?.condition ?? "new")}, authenticated by ${STORE_NAME}.`;
  return { title, description, openGraph: { title, description, images: p.images.slice(0, 1) } };
}

export default function ProductPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="mx-auto h-[70vh] max-w-7xl" aria-busy="true" />}>
      <Product params={params} />
    </Suspense>
  );
}

// Unknown slugs render the not-found UI inside the streamed page; Next adds <meta name="robots" content="noindex">.
async function Product({ params }: { params: Params }) {
  const { slug } = await params;
  await connection();
  const p = await getProduct(slug);
  if (!p) notFound();
  const related = (await getCatalog())
    .filter((x) => x.id !== p.id && x.available && (x.brandSlug === p.brandSlug || x.categorySlug === p.categorySlug))
    .slice(0, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    image: p.images,
    description: p.description ?? undefined,
    offers: {
      "@type": "Offer",
      price: p.price,
      priceCurrency: process.env.NEXT_PUBLIC_CURRENCY ?? "GBP",
      availability: p.available ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      itemCondition: p.variants.every((v) => v.condition.startsWith("new")) ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <TrackProductView productId={p.id} category={p.category} brand={p.brand} price={p.price} />
      <nav className="mb-4 text-xs text-[var(--ink-3)]" aria-label="Breadcrumb">
        <Link href="/shop" className="hover:underline">Shop</Link>
        {p.categorySlug && <> / <Link href={`/shop?category=${p.categorySlug}`} className="hover:underline">{p.category}</Link></>}
        {p.brandSlug && <> / <Link href={`/shop?brand=${p.brandSlug}`} className="hover:underline">{p.brand}</Link></>}
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <Gallery images={p.images} title={p.title} placeholder={p.brand || p.title} />
        <div className="lg:sticky lg:top-20 lg:self-start">
          {p.brand && <Link href={`/shop?brand=${p.brandSlug}`} className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-2)] hover:underline">{p.brand}</Link>}
          <h1 className="shop-display mt-2 text-4xl sm:text-5xl">{p.title}</h1>
          <BuyBox
            product={{ id: p.id, title: p.title, brand: p.brand, category: p.category, allowOffers: p.allowOffers, available: p.available }}
            variants={p.variants}
          />
          <div className="mt-8 space-y-4 border-t border-[var(--border)] pt-6 text-sm">
            {p.description && <p className="whitespace-pre-line leading-relaxed">{p.description}</p>}
            <div className="flex gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
              <div><span className="font-semibold">Authenticity guaranteed.</span> {p.authenticity ?? "Every item is checked by hand before it's listed."}</div></div>
            <div className="flex gap-3"><Truck size={18} className="mt-0.5 shrink-0" aria-hidden />
              <div><span className="font-semibold">Tracked shipping.</span> Ships within 1–2 working days. <Link href="/info/shipping" className="underline">Details</Link></div></div>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="shop-display mb-5 text-4xl">You might also like</h2>
          <ProductGrid products={related} priorityCount={0} />
        </section>
      )}
    </div>
  );
}
