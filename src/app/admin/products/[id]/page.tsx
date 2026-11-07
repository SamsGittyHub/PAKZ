import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getLookups, getProduct } from "@/lib/admin/products";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { ProductForm } from "../ProductForm";
import { ProductInsight } from "../ProductInsight";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<PageSkeleton />}><EditProduct params={params} /></Suspense>;
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p, lookups] = await Promise.all([getProduct(admin, id), getLookups()]);
  if (!p) notFound();
  return (
    <>
      <PageHeader
        title={p.title}
        description={<>Listed {fmt.date(p.listed_at ?? p.created_at)} · <span className="capitalize">{p.status}</span> · <Link className="underline" href={`/admin/inventory?product=${p.id}`}>Stock & history</Link></>}
      />
      <ProductForm
        {...lookups}
        canSeeCosts={admin.canSeeCosts}
        initial={{
          id: p.id, title: p.title, slug: p.slug, description: p.description ?? "", category_id: p.category_id ?? "",
          brand_id: p.brand_id ?? "", status: p.status, tags: p.tags, featured: p.featured, allow_offers: p.allow_offers,
          offer_floor_price: p.offer_floor_price?.toString() ?? "", seo_title: p.seo_title ?? "", seo_description: p.seo_description ?? "",
          authenticity_notes: p.authenticity_notes ?? "", publish_at: toLocalInput(p.publish_at), drop_id: p.drop_id ?? "",
          images: p.images.map((i) => ({ id: i.id, url: i.url, is_cover: i.is_cover })),
          variants: p.variants.map((v) => ({
            id: v.id, size: v.size ?? "", condition: v.condition as "new", sku: v.sku ?? "", price: String(v.price),
            cost_price: v.cost_price != null ? String(v.cost_price) : "", low_stock_threshold: String(v.low_stock_threshold),
            status: v.status as "active", quantity: v.quantity, reserved: v.reserved_quantity,
          })),
        }}
      />
      <Section title="Performance" className="mt-4">
        <ProductInsight productId={p.id} />
      </Section>
    </>
  );
}
