export interface VariantVelocityRow {
  variant_id: string;
  product_id: string;
  title: string;
  size: string | null;
  quantity: number;
  reserved_quantity: number;
  low_stock_threshold: number;
  units_sold: number;
  first_sale: string | null;
}

export interface StockoutPrediction extends VariantVelocityRow {
  /** units per day over the window */
  rate: number;
  daysLeft: number | null;
  stockoutDate: string | null;
}

/**
 * Predict when each variant runs out at its current sell-through rate.
 * Rate uses the full window (not days since first sale) so a single lucky sale doesn't imply a huge rate.
 */
export function predictStockouts(rows: VariantVelocityRow[], windowDays: number, now = new Date()): StockoutPrediction[] {
  return rows.map((r) => {
    const rate = r.units_sold / windowDays;
    const available = r.quantity;
    if (rate <= 0) return { ...r, rate: 0, daysLeft: null, stockoutDate: null };
    const daysLeft = available / rate;
    const date = new Date(now.getTime() + daysLeft * 86_400_000);
    return { ...r, rate, daysLeft, stockoutDate: date.toISOString().slice(0, 10) };
  });
}
