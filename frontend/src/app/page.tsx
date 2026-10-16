"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, FolderGit2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/tooltip";
import { DataState, Legend, NextStep } from "@/components/page";
import { Term } from "@/components/term";
import { Welcome } from "@/components/welcome";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi, withScope } from "@/lib/api";
import { MODEL_COLOR, compact, int, pct, pp } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = { good: "var(--good)", warning: "var(--warning)", info: "var(--accent)" };

const PIPELINE = [
  { step: "Ingest", detail: "311 MB, sha256-pinned, schema-validated Parquet" },
  { step: "SQL", detail: "6 views and 20 DuckDB queries" },
  { step: "Statistics", detail: "tests, balance, Lin + doubly-robust, Bayes" },
  { step: "Uplift", detail: "5 strategies, held-out, paired bootstrap" },
  { step: "Decision", detail: "simulator, brief, planner, sequential lab" },
];

export default function InsightsPage() {
  const { scope } = useApp();
  const { data, error, loading } = useApi<any>(scope ? withScope("/insights", scope) : null);
  React.useEffect(() => {
    document.title = "ExperimentOS · Insights";
  }, []);
  const h = data?.headline;
  const conc = data?.concentration;

  return (
    <DataState loading={loading} error={error} hasData={!!data}>
      {data ? (
        <div className="flex flex-col gap-6">
          <Welcome />
          <section className="rounded-lg border border-border bg-surface px-6 py-7 sm:px-8" data-testid="hero">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.meta.is_sample ? "warning" : "accent"} data-testid="scope-badge">
                {data.meta.is_sample ? "Development sample" : "Full dataset"} · {int(data.meta.n_rows)} users
              </Badge>
              <Badge>{data.meta.dataset}</Badge>
              <Badge>seed {data.meta.seed}</Badge>
            </div>
            <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              Advertising works. Raw numbers overstate it, and a small group of users carries most of the effect.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">
              ExperimentOS analyses a {compact(h.users)}-user randomised advertising experiment end to end: is the effect real, how large is it once the two groups are made comparable, who drives it (the <Term k="persuadables">persuadables</Term>), and what to do about it. Every number below is computed from the data and links to its evidence.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              {[
                { label: "Visit lift, raw", value: pp(h.effect, 2) },
                { label: "Visit lift, covariate-adjusted", value: h.adjusted_effect != null ? pp(h.adjusted_effect, 2) : "–" },
                { label: "Incremental visits from the top 10%", value: pct(h.top10_share, 0) },
                { label: "Recommended coverage (illustrative economics)", value: h.recommended_pct ? `${h.recommended_pct.toFixed(0)}%` : "none" },
              ].map((x) => (
                <div key={x.label}>
                  <dt className="text-xs text-secondary">{x.label}</dt>
                  <dd className="mt-1 text-3xl font-semibold tracking-tight">{x.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="findings">
            <h2 id="findings" className="mb-3 text-sm font-semibold">What the data says</h2>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="insight-grid">
              {data.insights.map((i: any) => (
                <Link key={i.id} href={i.href} data-testid={`insight-${i.id}`}
                  className="group flex flex-col rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: TONE[i.tone] }} aria-hidden />
                    {i.kicker}
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight">{i.value}</div>
                  <h3 className="mt-1 text-sm font-semibold leading-snug">{i.title}</h3>
                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-secondary">{i.detail}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
                    See the evidence <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Where the effect lives</CardTitle>
              <CardDescription>
                Share of the incremental visits you would get by treating everyone, captured by treating only the top fraction of users (held-out test split, covariate-adjusted). {conc.note}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Legend items={Object.entries<any>(conc.series).map(([id, s]) => ({ label: s.name, color: MODEL_COLOR[id], dashed: id === "random" }))} />
              <div className="mt-2 h-[320px]" role="img" aria-label="Share of total incremental visits captured by share of users treated" data-testid="concentration-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={conc.fraction.map((f: number, k: number) => ({ x: Math.round(f * 100), ...Object.fromEntries(Object.entries<any>(conc.series).map(([id, s]) => [id, s.share[k] * 100])) }))} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={[0, 10, 20, 40, 60, 80, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={{ stroke: "var(--axis)" }}
                      label={{ value: "Share of users treated (highest predicted uplift first)", position: "insideBottom", offset: -10 }} />
                    <YAxis tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={48} />
                    <ReferenceLine x={10} stroke="var(--text-muted)" label={{ value: `top 10% → ${pct(h.top10_share, 0)}`, position: "insideTopRight", fontSize: 10, fill: "var(--text-secondary)" }} />
                    {Object.keys(conc.series).map((id) => (
                      <Line key={id} dataKey={id} name={conc.series[id].name} stroke={MODEL_COLOR[id]} strokeWidth={2} strokeDasharray={id === "random" ? "5 4" : undefined} dot={false} isAnimationActive={false} />
                    ))}
                    <Tooltip cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }} content={<ChartTooltip title={(l) => `Top ${l}% treated`} format={(v) => `${v.toFixed(1)}% of total`} />} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="how">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="how" className="text-sm font-semibold">How it was built</h2>
              <a href="https://github.com/karansalot/ExperimentOS" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent" target="_blank" rel="noreferrer">
                <FolderGit2 className="h-3.5 w-3.5" aria-hidden /> Source on GitHub
              </a>
            </div>
            <ol className="mt-4 grid gap-3 sm:grid-cols-5">
              {PIPELINE.map((p, k) => (
                <li key={p.step} className={cn("relative rounded-md border border-border px-3 py-3")}>
                  <div className="text-[11px] font-medium text-muted tabular">{k + 1}</div>
                  <div className="text-sm font-semibold">{p.step}</div>
                  <div className="mt-0.5 text-xs leading-snug text-secondary">{p.detail}</div>
                </li>
              ))}
            </ol>
          </section>
          <NextStep />
        </div>
      ) : null}
    </DataState>
  );
}
