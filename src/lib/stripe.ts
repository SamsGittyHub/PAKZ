import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = env.stripeSecret();
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  client ??= new Stripe(key);
  return client;
}

export const toMinor = (amount: number) => Math.round(amount * 100);
export const fromMinor = (amount: number | null | undefined) => (amount ?? 0) / 100;
