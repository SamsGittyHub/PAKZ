import Link from "next/link";
import type { ShopProduct } from "@/lib/shop/catalog";
import { price } from "./price";

const CONDITION: Record<string, string> = {
  new: "New", new_defects: "New (flaws)", used_excellent: "Excellent", used_good: "Good", used_fair: "Fair",
};
export const conditionLabel = (c: string) => CONDITION[c] ?? c;

export function ProductCard({ p, priority = false }: { p: ShopProduct; priority?: boolean }) {
  return (
    <Link href={`/product/${p.slug}`} className="group block" prefetch={false}>
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--surface-2)]">
        {p.images[0] ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.images[0]} alt={p.title} loading={priority ? "eager" : "lazy"}
              className={`h-full w-full object-cover transition duration-300 ${p.images[1] ? "group-hover:opacity-0" : "group-hover:scale-[1.03]"} ${p.available ? "" : "opacity-60 grayscale"}`} />
            {p.images[1] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.images[1]} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-300 group-hover:opacity-100" />
            )}
          </>
        ) : (
          <div className="shop-display grid h-full w-full place-items-center p-4 text-center text-3xl text-[var(--ink-3)]">{p.brand || p.title}</div>
        )}
        {!p.available && <span className="absolute left-2 top-2 bg-[var(--ink)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--page)]">Sold</span>}
        {p.available && p.featured && <span className="absolute left-2 top-2 bg-[var(--page)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">Grail</span>}
      </div>
      <div className="mt-2 space-y-0.5 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">{p.brand}</div>
        <div className="line-clamp-1">{p.title}</div>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`tnum font-semibold ${p.available ? "" : "text-[var(--ink-3)] line-through"}`}>{price(p.price)}</span>
          {p.available && p.sizes.length > 0 && <span className="truncate text-xs text-[var(--ink-3)]">{p.sizes.slice(0, 4).join(" · ")}{p.sizes.length > 4 ? " +" : ""}</span>}
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 4 }: { products: ShopProduct[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => <ProductCard key={p.id} p={p} priority={i < priorityCount} />)}
    </div>
  );
}
