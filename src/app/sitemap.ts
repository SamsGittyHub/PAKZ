import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getCatalog } from "@/lib/shop/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const products = (await getCatalog()).filter((p) => p.available);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/drops`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/sell`, changeFrequency: "monthly", priority: 0.5 },
    ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.listedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
