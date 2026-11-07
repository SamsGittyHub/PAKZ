# Storefront tracking

The tracker is first-party (no third-party scripts). `<Analytics />` in the root layout records `page_view`
on every navigation and engagement time when a page is hidden. Everything else is one call:

```ts
import { track, setPageContext } from "@/lib/track/client";

// Product page (also attributes time-on-page to the product)
setPageContext({ product_id, category, brand });
track("product_view", { product_id, category, brand });

track("search", { query, value: results.length });            // value 0 = zero-result search (demand signal)
track("filter_used", { props: { filter: "size", value: "UK 9" } });
track("add_to_cart", { product_id, variant_id, category, brand, value: price });
track("remove_from_cart", { product_id, variant_id });
track("checkout_started", { value: cartTotal });
track("waitlist_signup", { product_id, props: { brand, size } });
track("offer_made", { product_id, value: amount });
```

`purchase` is **not** sent from the browser. The Stripe webhook records it server-side from the
Checkout Session, so revenue can't be faked or double-counted. When creating the Checkout Session, set:

```ts
metadata: {
  items: JSON.stringify([{ variant_id, quantity, unit_price }]),
  session_id: currentAnalyticsSessionId, // read from localStorage "pakz_sid" (consented) — omit otherwise
  reserved: "1", // only if you reserved stock for the cart via adjust_stock(..., 'reserved')
}
```

## Consent

`ConsentBanner` sets the `pakz_consent` cookie.

| | Granted | Declined |
|---|---|---|
| Visitor id | persistent (localStorage) | none |
| Session | 30-minute rolling, survives reloads | in-memory per tab |
| Referrer host stored | yes | no |
| New vs returning | yes | everyone counts as new |

## Exclusions

- Admin devices: the admin sidebar sets `pakz_admin=1`; both the tracker and `/api/track` ignore it. `/admin` paths are never tracked.
- Bots: user-agent filter (crawlers, headless browsers, HTTP libraries), `navigator.webdriver`, and a behavioural
  filter in `track_ingest()` (absurd event volume, or 20+ page views faster than one per 1.5s). A flagged session's
  events are deleted and it drops out of every report.

## Batching

Events queue in memory and flush every 5s, at 20 events, and via `navigator.sendBeacon` on `visibilitychange`/`pagehide`.
Each batch is ≤ 50 events / 64 KB. Event times are corrected server-side from each event's age in the batch.
