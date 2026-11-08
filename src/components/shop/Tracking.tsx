"use client";
import { useEffect } from "react";
import { setPageContext, track } from "@/lib/track/client";

export function TrackSearch({ query, results }: { query: string; results: number }) {
  useEffect(() => { track("search", { query, value: results }); }, [query, results]);
  return null;
}

export function TrackProductView({ productId, category, brand, price }: { productId: string; category: string; brand: string; price: number }) {
  useEffect(() => {
    setPageContext({ product_id: productId, category, brand });
    track("product_view", { product_id: productId, category, brand, value: price });
  }, [productId, category, brand, price]);
  return null;
}
