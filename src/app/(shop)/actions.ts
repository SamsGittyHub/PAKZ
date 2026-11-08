"use server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { env } from "@/lib/env";
import { imageUrl, putImage } from "@/lib/storage";
import { stripe, toMinor } from "@/lib/stripe";
import { getShippingRates, invalidateCatalog } from "@/lib/shop/catalog";
import { rateLimit } from "@/lib/shop/rate-limit";

type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false, error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e),
});
const TOO_MANY = "Too many attempts — please wait a few minutes and try again.";

// ---------------------------------------------------------------------------
// Bag
// ---------------------------------------------------------------------------
export interface BagLine {
  variant_id: string; slug: string; title: string; brand: string; size: string | null; condition: string;
  price: number; available: number; image: string | null; purchasable: boolean;
}

/** Live prices and stock for the bag (never cached). */
export async function getBagLines(variantIds: string[]): Promise<BagLine[]> {
  const ids = [...new Set(variantIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  if (!ids.length) return [];
  const rows = must(
    await db().from("product_variants")
      .select("id, size, condition, price, quantity, status, products(slug, title, status, brands(name), product_images(path, position, is_cover))")
      .in("id", ids),
    "bag",
  ) as unknown as {
    id: string; size: string | null; condition: string; price: number; quantity: number; status: string;
    products: { slug: string; title: string; status: string; brands: { name: string } | null; product_images: { path: string; position: number; is_cover: boolean }[] } | null;
  }[];
  return rows.filter((r) => r.products).map((r) => {
    const cover = [...r.products!.product_images].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)[0];
    const purchasable = r.products!.status === "active" && r.status === "active" && r.quantity > 0;
    return {
      variant_id: r.id, slug: r.products!.slug, title: r.products!.title, brand: r.products!.brands?.name ?? "",
      size: r.size, condition: r.condition, price: Number(r.price), available: purchasable ? r.quantity : 0,
      image: imageUrl(cover?.path), purchasable,
    };
  });
}

const SHIP_COUNTRIES = (process.env.SHIP_COUNTRIES ?? "GB").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);

/** Reserve the bag's stock and open a Stripe Checkout session (30 minutes to pay). */
export async function startCheckout(
  items: { variant_id: string; quantity: number }[],
  analyticsSessionId: string | null,
): Promise<Result<{ url: string }>> {
  try {
    if (!(await rateLimit("checkout", 10, 10 * 60_000))) throw new Error(TOO_MANY);
    if (!env.stripeSecret()) throw new Error("Online checkout isn't switched on yet — message us on Instagram to buy.");
    const parsed = z.array(z.object({ variant_id: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1).max(25).parse(items);

    const { data, error } = await db().rpc("checkout_open", { p_items: parsed, p_analytics_session_id: analyticsSessionId });
    if (error) throw new Error(error.message);
    invalidateCatalog();
    const checkout = data as { id: string; subtotal: number; items: { variant_id: string; product_id: string; quantity: number; unit_price: number; title: string; size: string | null }[] };

    try {
      const { data: settings } = await db().from("store_settings").select("currency").eq("id", 1).single();
      const currency = String(settings?.currency ?? "GBP").toLowerCase();
      const images = must(await db().from("product_images").select("product_id, path, is_cover, position").in("product_id", checkout.items.map((i) => i.product_id)), "images");
      const cover = (pid: string) => images.filter((i) => i.product_id === pid).sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)[0];
      const rates = (await getShippingRates()).slice(0, 5);
      const subtotal = Number(checkout.subtotal);
      const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;

      const session = await stripe().checkout.sessions.create({
        mode: "payment",
        line_items: checkout.items.map((i) => {
          const img = cover(i.product_id);
          return {
            quantity: i.quantity,
            price_data: {
              currency,
              unit_amount: toMinor(Number(i.unit_price)),
              product_data: { name: i.size ? `${i.title} — ${i.size}` : i.title, ...(img ? { images: [`${env.siteUrl}${imageUrl(img.path)}`] } : {}) },
            },
          };
        }),
        shipping_address_collection: { allowed_countries: SHIP_COUNTRIES as never },
        ...(rates.length ? {
          shipping_options: rates.map((r) => {
            const free = r.free_over != null && subtotal >= Number(r.free_over);
            return { shipping_rate_data: { type: "fixed_amount" as const, display_name: free ? `${r.name} (free)` : r.name, fixed_amount: { amount: free ? 0 : toMinor(Number(r.price)), currency } } };
          }),
        } : {}),
        phone_number_collection: { enabled: true },
        expires_at: expiresAt,
        client_reference_id: checkout.id,
        metadata: { checkout_id: checkout.id, ...(analyticsSessionId ? { session_id: analyticsSessionId } : {}) },
        success_url: `${env.siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.siteUrl}/bag?cancelled=${checkout.id}`,
      });
      await db().rpc("checkout_attach", { p_id: checkout.id, p_stripe_session_id: session.id, p_expires_at: new Date(expiresAt * 1000).toISOString() });
      return { ok: true, data: { url: session.url! } };
    } catch (e) {
      await db().rpc("checkout_release", { p_id: checkout.id });
      invalidateCatalog();
      console.error("[checkout] stripe session failed", e);
      throw new Error("We couldn't start checkout. Please try again in a moment.");
    }
  } catch (e) {
    return fail(e);
  }
}

/** Shopper came back from Stripe without paying: release the hold right away. */
export async function cancelCheckout(checkoutId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) return;
  const { data } = await db().from("checkouts").select("stripe_session_id, status").eq("id", checkoutId).maybeSingle();
  if (!data || data.status !== "open") return;
  if (data.stripe_session_id && env.stripeSecret()) {
    try { await stripe().checkout.sessions.expire(data.stripe_session_id); } catch { /* already expired/complete */ }
  }
  // If the session completed in the meantime the webhook wins; release only touches open checkouts.
  const { data: fresh } = await db().from("checkouts").select("status").eq("id", checkoutId).maybeSingle();
  if (fresh?.status === "open") {
    await db().rpc("checkout_release", { p_id: checkoutId });
    invalidateCatalog();
  }
}

// ---------------------------------------------------------------------------
// Offers, waitlist, raffles
// ---------------------------------------------------------------------------
const email = z.string().trim().toLowerCase().email("Enter a valid email");

export async function makeOffer(input: { product_id: string; variant_id?: string; email: string; amount: number; message?: string; website?: string }): Promise<Result<{ status: string }>> {
  try {
    if (input.website) return { ok: true, data: { status: "pending" } }; // honeypot
    if (!(await rateLimit("offer", 5, 10 * 60_000))) throw new Error(TOO_MANY);
    const o = z.object({
      product_id: z.string().uuid(), variant_id: z.string().uuid().optional(), email,
      amount: z.number().positive("Enter an amount").max(100_000), message: z.string().max(500).optional(),
    }).parse(input);
    const { data: p } = await db().from("products").select("status, allow_offers").eq("id", o.product_id).maybeSingle();
    if (!p || p.status !== "active" || !p.allow_offers) throw new Error("This item isn't taking offers");
    const row = must(await db().from("offers").insert({
      product_id: o.product_id, variant_id: o.variant_id ?? null, email: o.email, amount: o.amount, message: o.message || null,
    }).select("status").single(), "offer");
    return {
      ok: true, data: { status: row.status },
      message: row.status === "auto_declined"
        ? "Thanks — that's below what we can accept for this one. Feel free to try a higher offer."
        : "Offer sent! We'll reply by email, usually within a day.",
    };
  } catch (e) { return fail(e); }
}

export async function joinWaitlist(input: { product_id?: string; variant_id?: string; size?: string; brand?: string; category?: string; keyword?: string; email: string; website?: string }): Promise<Result> {
  try {
    if (input.website) return { ok: true };
    if (!(await rateLimit("waitlist", 8, 10 * 60_000))) throw new Error(TOO_MANY);
    const w = z.object({
      product_id: z.string().uuid().optional(), variant_id: z.string().uuid().optional(), size: z.string().max(40).optional(),
      brand: z.string().max(80).optional(), category: z.string().max(80).optional(), keyword: z.string().max(120).optional(), email,
    }).parse(input);
    if (!w.product_id && !w.keyword && !w.brand) throw new Error("Tell us what you're looking for");
    let dup = db().from("waitlist").select("id").eq("email", w.email).is("notified_at", null);
    dup = w.product_id ? dup.eq("product_id", w.product_id) : dup.is("product_id", null).eq("keyword", w.keyword ?? "");
    if ((await dup.limit(1)).data?.length) return { ok: true, message: "You're already on the list." };
    must(await db().from("waitlist").insert({
      product_id: w.product_id ?? null, variant_id: w.variant_id ?? null, size: w.size || null, brand: w.brand || null,
      category: w.category || null, keyword: w.keyword?.toLowerCase() || null, email: w.email,
    }).select("id"), "waitlist");
    return { ok: true, message: "You're on the list — we'll email you first." };
  } catch (e) { return fail(e); }
}

export async function enterRaffle(input: { raffle_id: string; email: string; size?: string; website?: string }): Promise<Result> {
  try {
    if (input.website) return { ok: true };
    if (!(await rateLimit("raffle", 6, 10 * 60_000))) throw new Error(TOO_MANY);
    const r = z.object({ raffle_id: z.string().uuid(), email, size: z.string().max(40).optional() }).parse(input);
    const { data: raffle } = await db().from("raffles").select("status, starts_at, ends_at").eq("id", r.raffle_id).maybeSingle();
    const now = Date.now();
    if (!raffle || raffle.status !== "open" || (raffle.starts_at && Date.parse(raffle.starts_at) > now) || (raffle.ends_at && Date.parse(raffle.ends_at) < now)) {
      throw new Error("This raffle isn't open");
    }
    const { error } = await db().from("raffle_entries").insert({ raffle_id: r.raffle_id, email: r.email, size: r.size || null });
    if (error?.code === "23505") return { ok: true, message: "You're already entered — good luck!" };
    if (error) throw new Error(error.message);
    return { ok: true, message: "You're in! Winners are emailed when the raffle closes." };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Sell to us
// ---------------------------------------------------------------------------
export async function submitSellRequest(form: FormData): Promise<Result> {
  try {
    if (form.get("website")) return { ok: true };
    if (!(await rateLimit("sell", 4, 30 * 60_000))) throw new Error(TOO_MANY);
    const s = z.object({
      name: z.string().trim().min(1, "Enter your name").max(100),
      email,
      phone: z.string().max(40).optional(),
      brand: z.string().max(80).optional(),
      item: z.string().trim().min(2, "Tell us what the item is").max(200),
      size: z.string().max(40).optional(),
      condition: z.enum(["new", "new_defects", "used_excellent", "used_good", "used_fair"]).optional(),
      asking_price: z.coerce.number().min(0).max(100_000).optional(),
      notes: z.string().max(2000).optional(),
    }).parse({
      name: form.get("name"), email: form.get("email"), phone: form.get("phone") || undefined, brand: form.get("brand") || undefined,
      item: form.get("item"), size: form.get("size") || undefined, condition: form.get("condition") || undefined,
      asking_price: form.get("asking_price") || undefined, notes: form.get("notes") || undefined,
    });
    const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 4);
    const id = crypto.randomUUID();
    const images: string[] = [];
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024 || !/^image\/(webp|jpeg|png|avif)$/.test(f.type)) throw new Error("Photos must be images under 8MB");
      const path = `sell-requests/${id}/${crypto.randomUUID()}.${f.type.split("/")[1]}`;
      await putImage(path, new Uint8Array(await f.arrayBuffer()), f.type);
      images.push(imageUrl(path)!);
    }
    must(await db().from("sell_requests").insert({
      name: s.name, email: s.email, phone: s.phone || null, brand: s.brand || null, item: s.item, size: s.size || null,
      condition: s.condition ?? null, asking_price: s.asking_price ?? null, notes: s.notes || null, images,
    }).select("id"), "sell request");
    return { ok: true, message: "Thanks! We'll review your item and get back to you within 48 hours." };
  } catch (e) { return fail(e); }
}
