import { Suspense } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { pageContext, one, type SearchParams } from "@/lib/admin/context";
import { db, must } from "@/lib/db";
import { fmt } from "@/lib/format";
import { redact } from "@/lib/auth";
import { PageHeader, PageSkeleton, Section, Empty } from "@/components/admin/PageHeader";
import { ActionButton } from "@/components/admin/ActionButton";
import { CsvButton } from "@/components/admin/CsvButton";
import { recomputeAnalytics, generateBriefNow } from "../forecasts/actions";
import { RecoCard, type Reco } from "./RecoCard";
import { ClearanceTable } from "./ClearanceTable";

const TYPES = [
  ["", "All"], ["restock", "Restock now"], ["stock_more", "Stock more"], ["no_supply", "No supply"], ["best_sizes", "Best sizes"],
  ["reprice", "Reprice"], ["clearance", "Clearance"], ["promote", "Promote"], ["stock_less", "Stock less"],
] as const;

export default function RecommendationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Recommendations searchParams={searchParams} /></Suspense>;
}

async function Recommendations({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, params } = await pageContext(searchParams);
  const type = one(params.type) ?? "";
  const status = one(params.status) ?? "new";
  let q = db().from("recommendations").select("*").eq("status", status).order("score", { ascending: false }).limit(300);
  if (type) q = q.eq("type", type);
  const [recs, brief, counts] = await Promise.all([
    q,
    db().from("ai_briefs").select("content, generated_at, model, week_start").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("recommendations").select("type").eq("status", "new"),
  ]);
  const rows = must(recs, "recs") as Reco[];
  const tally = must(counts, "counts").reduce<Record<string, number>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {});
  // Link product/variant-scoped recommendations to the right page.
  const withLinks = rows.map((r) => ({
    ...r,
    data: redact(admin, r.data),
    // Reason text for staff must not reveal margins.
    reason: admin.canSeeCosts ? r.reason : r.reason.replace(/ and earns just -?\d+% margin/g, "").replace(/, (\d+(\.\d+)?% )?margin[^.;]*/gi, ""),
    href: r.scope === "product" ? `/admin/products/${r.scope_value}` : r.scope === "variant" ? `/admin/inventory/${r.scope_value}` : undefined,
  }));
  const b = brief.data;
  const cards = withLinks.filter((r) => r.type !== "clearance");
  const clearance = withLinks.filter((r) => r.type === "clearance").map((r) => ({
    id: r.id, status: r.status, scope_value: r.scope_value, score: Math.round(r.score),
    product: r.title.replace(/^Clear out: /, ""), ...r.data,
  }));

  return (
    <>
      <PageHeader
        title="What should I stock?"
        description="Demand scores combine view trend, add-to-cart and conversion rates, sell-through, speed, margin, waitlists, offers and zero-result searches. Recomputed nightly."
        actions={admin.role === "owner" ? <ActionButton action={recomputeAnalytics}>Recompute now</ActionButton> : undefined}
      />
      <Section title="Weekly Buying Brief" className="mb-4" actions={admin.role === "owner" ? <ActionButton action={generateBriefNow} className="btn btn-sm"><Sparkles size={14} /> Generate</ActionButton> : undefined}>
        {b ? (
          <>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{b.content}</div>
            <p className="faint mt-3 text-xs">Week of {fmt.date(b.week_start)} · generated {fmt.dateTime(b.generated_at)} by {b.model} from aggregated metrics only (no customer data).</p>
          </>
        ) : <Empty>No brief yet. It&apos;s generated every Monday when ANTHROPIC_API_KEY is set.</Empty>}
      </Section>

      <nav className="mb-3 flex flex-wrap gap-1" aria-label="Recommendation type">
        {TYPES.map(([v, l]) => (
          <Link key={v} href={`/admin/recommendations?type=${v}&status=${status}`} className={`btn btn-sm ${type === v ? "btn-primary" : ""}`}>
            {l}{v && tally[v] ? <span className="faint ml-1">{tally[v]}</span> : null}
          </Link>
        ))}
        <span className="mx-1 border-l border-[var(--border)]" />
        {["new", "actioned", "dismissed"].map((s) => (
          <Link key={s} href={`/admin/recommendations?type=${type}&status=${s}`} className={`btn btn-sm ${status === s ? "btn-primary" : "btn-ghost"}`}>{fmt.label(s)}</Link>
        ))}
        <span className="ml-auto"><CsvButton rows={withLinks.map(({ data, href: _h, ...r }) => (void _h, { ...r, data }))} filename="recommendations" /></span>
      </nav>
      {withLinks.length === 0 ? <Section><Empty>No recommendations here. They appear once there&apos;s traffic and sales data.</Empty></Section> : (
        <>
          {cards.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{cards.map((r) => <RecoCard key={r.id} r={r} />)}</div>}
          {clearance.length > 0 && (
            <Section title={`Clearance candidates (${clearance.length})`} className="mt-4">
              <p className="faint mb-3 text-xs">Listed 60+ days. Suggested markdown is 15% at 60 days and 25% at 90+, never below cost.</p>
              <ClearanceTable rows={clearance} />
            </Section>
          )}
        </>
      )}
    </>
  );
}
