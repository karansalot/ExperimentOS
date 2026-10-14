"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Legend } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { int, num, pct } from "@/lib/format";

function AgreementTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-secondary">{p.feature} · {p.segment} · {int(p.n)} users</div>
      <div><span className="font-semibold tabular">{p.pred.toFixed(3)} pp</span> <span className="text-secondary">predicted</span></div>
      <div><span className="font-semibold tabular">{p.obs.toFixed(3)} ± {(1.96 * p.se).toFixed(3)} pp</span> <span className="text-secondary">observed (doubly robust)</span></div>
    </div>
  );
}

/** Explainability for the champion model: permutation importance, segment agreement, persuadables profile. */
export function ExplainPanel({ ex, outcome }: { ex: any; outcome: string }) {
  const imp = ex.importance;
  const max = Math.max(...imp.map((r: any) => Math.max(r.drop_max, 0)), 1e-12);
  const pts = ex.segment_agreement.map((s: any) => ({ feature: s.feature, segment: s.segment, n: s.n_users, pred: s.mean_predicted * 100, obs: s.observed * 100, se: s.observed_std_error * 100 }));
  const lim = Math.max(...pts.flatMap((p: any) => [p.pred, p.obs])) * 1.08;
  const lo = Math.min(0, ...pts.flatMap((p: any) => [p.pred, p.obs])) * 1.08;

  return (
    <div id="explain" className="flex scroll-mt-6 flex-col gap-4" data-testid="explain-panel">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What drives predicted uplift: {ex.model_name}</CardTitle>
            <CardDescription>
              Permutation importance: how much covariate-adjusted gain over random is lost when one feature is shuffled. Computed on a seeded sample of {int(ex.importance_sample.rows)} of {int(ex.importance_sample.of_test_rows)} test users, {ex.importance_sample.repeats} shuffles each; bars show the mean, whiskers the range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2" role="img" aria-label="Permutation importance by feature" data-testid="importance-bars">
              {imp.map((r: any) => (
                <div key={r.feature} className="grid grid-cols-[40px_1fr_120px] items-center gap-2 text-xs" title={`${r.feature}: ${(r.drop * 1000).toFixed(3)} per 1,000 users (${pct(r.share_of_gain, 0)} of the gain)`}>
                  <span className="font-mono text-secondary">{r.feature}</span>
                  <div className="relative h-3.5 border-l border-[color:var(--axis)]">
                    <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent" style={{ width: `${(Math.max(r.drop, 0) / max) * 100}%` }} />
                    <div className="absolute top-1/2 h-px bg-[color:var(--text-secondary)]" style={{ left: `${(Math.max(r.drop_min, 0) / max) * 100}%`, width: `${((Math.max(r.drop_max, 0) - Math.max(r.drop_min, 0)) / max) * 100}%` }} />
                  </div>
                  <span className="text-right tabular">{(r.drop * 1000).toFixed(2)} <span className="text-muted">({pct(r.share_of_gain, 0)})</span></span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Units: lost incremental {outcome}s per 1,000 users (share of the model&apos;s {(imp[0].base_gain * 1000).toFixed(2)} gain). Correlated features share credit, so small values do not mean a feature is useless.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Does the model&apos;s heterogeneity match the data?</CardTitle>
            <CardDescription>
              Each dot is a feature segment on the test split: mean predicted uplift against observed doubly-robust uplift. Dots on the diagonal mean the model learned real differences, not noise. Correlation {num(ex.agreement_correlation, 3)}; size-weighted average gap {(ex.agreement_weighted_mae * 100).toFixed(3)} pp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Legend items={[{ label: "Feature segment", color: "var(--accent)", shape: "dot" }, { label: "Perfect agreement", color: "var(--text-muted)" }]} />
            <div className="mt-2 h-[280px]" role="img" aria-label="Predicted versus observed uplift by segment" data-testid="agreement-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 16, bottom: 22, left: 8 }}>
                  <CartesianGrid />
                  <XAxis type="number" dataKey="pred" domain={[lo, lim]} tickFormatter={(v) => v.toFixed(1)} tickLine={false} axisLine={{ stroke: "var(--axis)" }} label={{ value: "Mean predicted uplift (pp)", position: "insideBottom", offset: -12 }} />
                  <YAxis type="number" dataKey="obs" domain={[lo, lim]} tickFormatter={(v) => v.toFixed(1)} tickLine={false} axisLine={false} width={44} label={{ value: "Observed (pp)", angle: -90, position: "insideLeft", style: { textAnchor: "middle" } }} />
                  <ZAxis range={[60, 60]} />
                  <ReferenceLine segment={[{ x: lo, y: lo }, { x: lim, y: lim }]} stroke="var(--text-muted)" />
                  <Scatter data={pts} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
                  <Tooltip cursor={false} content={<AgreementTooltip />} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who are the persuadables?</CardTitle>
          <CardDescription>
            The top 10% of test users by predicted uplift compared with everyone else. Features are anonymised random projections, so this tells you whom to target, not why they respond.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="persuadables-table">
            <THead><TR><TH>Feature</TH><TH className="text-right">Standardised difference</TH><TH className="text-right">Off modal value: top 10%</TH><TH className="text-right">Off modal value: everyone else</TH></TR></THead>
            <TBody>
              {ex.persuadables.slice(0, 8).map((r: any) => (
                <TR key={r.feature} className="tabular">
                  <TD className="font-mono">{r.feature}</TD>
                  <TD className="text-right font-medium">{r.smd >= 0 ? "+" : "−"}{Math.abs(r.smd).toFixed(2)}</TD>
                  <TD className="text-right">{pct(r.share_off_modal_top, 0)}</TD>
                  <TD className="text-right">{pct(r.share_off_modal_rest, 0)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
