import type { Metadata } from "next";
import { SellForm } from "@/components/shop/SellForm";

export const metadata: Metadata = { title: "Sell to us", description: "Get an offer on your sneakers and streetwear within 48 hours." };

const STEPS = [
  ["Send photos", "Tell us what you've got and add a few clear photos — tags, soles, any flaws."],
  ["Get an offer", "We reply within 48 hours with a cash offer."],
  ["Get paid", "Accept, ship it free or drop it off, and get paid as soon as it's checked."],
];

export default function SellPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <h1 className="shop-display text-5xl sm:text-8xl">Sell to us</h1>
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_1.3fr]">
        <ol className="space-y-6">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span className="shop-display text-5xl text-[var(--ink-3)]">{i + 1}</span>
              <div><h2 className="font-semibold">{title}</h2><p className="text-[var(--ink-2)]">{body}</p></div>
            </li>
          ))}
        </ol>
        <SellForm />
      </div>
    </div>
  );
}
