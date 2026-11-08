import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getAdmin, redact } from "@/lib/auth";
import { db, must, rpc } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { resolveRange } from "@/lib/dates";
import { listProducts } from "@/lib/admin/products";
import { listOrders } from "@/lib/admin/orders";
import { DIMENSIONS, getBreakdown, getPnl } from "@/lib/admin/revenue";

const csv = (rows: Record<string, unknown>[], name: string, columns?: string[]) =>
  new NextResponse(toCsv(rows, columns), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" },
  });

export async function GET(req: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const dataset = sp.get("dataset");
  const { data: settings } = await db().from("store_settings").select("timezone").eq("id", 1).single();
  const range = resolveRange(Object.fromEntries(sp.entries()), settings?.timezone ?? "UTC");
  const stamp = `${range.fromDate}_${range.toDate}`;

  switch (dataset) {
    case "products": {
      // One row per variant — the same shape the importer accepts.
      const rows = must(await db().from("product_variants").select("size, condition, sku, price, cost_price, quantity, reserved_quantity, status, products!inner(title, status, description, tags, categories(name), brands(name))").neq("products.status", "archived"), "variants") as unknown as
        { size: string | null; condition: string; sku: string | null; price: number; cost_price: number; quantity: number; reserved_quantity: number; status: string; products: { title: string; status: string; description: string | null; tags: string[]; categories: { name: string } | null; brands: { name: string } | null } }[];
      const out = rows.map((v) => ({
        title: v.products.title, brand: v.products.brands?.name ?? "", category: v.products.categories?.name ?? "", description: v.products.description ?? "",
        status: v.products.status, size: v.size ?? "", condition: v.condition, price: v.price, cost: v.cost_price, quantity: v.quantity,
        reserved: v.reserved_quantity, sku: v.sku ?? "", tags: v.products.tags.join(";"),
      }));
      return csv(redact(admin, out), "products");
    }
    case "products_summary":
      return csv(await listProducts(admin, {}) as unknown as Record<string, unknown>[], "products-summary");
    case "orders":
      return csv(await listOrders(admin, { status: sp.get("status") ?? undefined }) as unknown as Record<string, unknown>[], "orders");
    case "customers":
      return csv(await rpc<Record<string, unknown>[]>("admin_customers", { p_search: null, p_limit: 100000 }), "customers");
    case "sales": {
      if (!admin.canSeeCosts) return NextResponse.json({ error: "owner only" }, { status: 403 });
      const rows = must(await db().from("sales_lines").select("*").gte("paid_at", range.from.toISOString()).lt("paid_at", range.to.toISOString()).order("paid_at").limit(100000), "sales");
      return csv(rows, `sales-${stamp}`);
    }
    case "pnl": {
      if (!admin.canSeeCosts) return NextResponse.json({ error: "owner only" }, { status: 403 });
      const [pnl, expenses, sales, ...breakdowns] = await Promise.all([
        getPnl(range.from, range.to),
        db().from("expenses").select("date, category, description, amount").gte("date", range.fromDate).lte("date", range.toDate).order("date"),
        db().from("sales_lines").select("order_number, paid_at, channel, title, size, category, brand, units, revenue, cogs, fees, shipping_cost, shipping_charged, tax").gte("paid_at", range.from.toISOString()).lt("paid_at", range.to.toISOString()).order("paid_at").limit(100000),
        ...DIMENSIONS.map((d) => getBreakdown(range.from, range.to, d)),
      ]);
      if (sp.get("format") !== "xlsx") return csv(Object.entries(pnl).map(([line, amount]) => ({ line, amount })), `pnl-${stamp}`);

      const wb = new ExcelJS.Workbook();
      wb.creator = "PAKZ Admin";
      const money = "#,##0.00";
      const summary = wb.addWorksheet("P&L");
      summary.columns = [{ header: "Line", key: "line", width: 32 }, { header: "Amount", key: "amount", width: 16, style: { numFmt: money } }];
      summary.addRow({ line: `Period ${range.fromDate} to ${range.toDate}` });
      Object.entries(pnl).forEach(([line, amount]) => summary.addRow({ line: line.replace(/_/g, " "), amount }));
      const sheet = (name: string, rows: Record<string, unknown>[]) => {
        const ws = wb.addWorksheet(name);
        const keys = rows.length ? Object.keys(rows[0]) : ["(no data)"];
        ws.columns = keys.map((k) => ({ header: k.replace(/_/g, " "), key: k, width: Math.max(12, k.length + 4) }));
        rows.forEach((r) => ws.addRow(r));
        ws.getRow(1).font = { bold: true };
      };
      sheet("Sales lines", must(sales, "sales"));
      sheet("Expenses", must(expenses, "expenses"));
      DIMENSIONS.forEach((d, i) => sheet(`By ${d}`, breakdowns[i].map(({ key: _k, ...r }) => (void _k, r))));
      summary.getRow(1).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="pakz-pnl-${stamp}.xlsx"`,
          "cache-control": "private, no-store",
        },
      });
    }
    default:
      return NextResponse.json({ error: "unknown dataset" }, { status: 400 });
  }
}
