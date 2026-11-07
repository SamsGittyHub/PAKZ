import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getLookups } from "@/lib/admin/products";
import { PageHeader, PageSkeleton } from "@/components/admin/PageHeader";
import { ProductForm } from "../ProductForm";

export default function NewProductPage() {
  return <Suspense fallback={<PageSkeleton />}><NewProduct /></Suspense>;
}

async function NewProduct() {
  const admin = await requireAdmin();
  const { categories, brands, drops } = await getLookups();
  return (
    <>
      <PageHeader title="New listing" />
      <ProductForm
        categories={categories} brands={brands} drops={drops} canSeeCosts={admin.canSeeCosts}
        initial={{
          title: "", slug: "", description: "", category_id: "", brand_id: "", status: "draft", tags: [], featured: false,
          allow_offers: false, offer_floor_price: "", seo_title: "", seo_description: "", authenticity_notes: "", publish_at: "",
          drop_id: "", variants: [], images: [],
        }}
      />
    </>
  );
}
