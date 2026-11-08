const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "GBP";
const LOCALE = process.env.NEXT_PUBLIC_LOCALE ?? "en-GB";
const whole = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, minimumFractionDigits: 2 });

/** Shop prices: £150 for whole amounts, £45.50 otherwise (never rounds). */
export const price = (n: number) => (Number.isInteger(Math.round(n * 100) / 100) ? whole : exact).format(n);
