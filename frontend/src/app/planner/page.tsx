"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Callout, DataState, PageHeader, StatTile } from "@/components/page";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OUTCOME_LABEL, compact, int, num, pct, pp } from "@/lib/format";

type Design = { outcome: string; base_rate_pct: string; mde_pct: string; share: number; alpha: number; power: number; users_per_day: string };
const DEFAULT: Design = { outcome: "visit", base_rate_pct: "", mde_pct: "5", share: 50, alpha: 0.05, power: 0.8, users_per_day: "" };

export default function PlannerPage() {
  const { scope, meta } = useApp();
  const [d, setD] = React.useState<Design>(DEFAULT);
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const set = (patch: Partial<Design>) => setD((prev) => ({ ...prev, ...patch }));

  const body = JSON.stringify({
    outcome: d.outcome,
    base_rate: d.base_rate_pct === "" ? null : Number(d.base_rate_pct) / 100,
    mde_relative: Number(d.mde_pct) / 100,
    treatment_share: d.share / 100,
    alpha: d.alpha,
    power: d.power,
    users_per_day: d.users_per_day === "" ? null : Number(d.users_per_day),
  });

  React.useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plan?scope=${scope}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(typeof json.detail === "string" ? json.detail : "Enter a base rate between 0 and 100% and a positive effect to detect.");
        setData(json);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [body, scope]);

  const r = data?.required;
  const obs = data?.observed_experiment;
  const inp = data?.inputs;

  return (
    <>
      <PageHeader
        title="Experiment planner"
        description="How many users does the next test need? Size a two-arm experiment before running it, and see what the unbalanced 85/15 design costs in sample."
        meta={data?.meta}
      />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card className="no-print self-start xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle>Design inputs</CardTitle>
            <CardDescription>The baseline defaults to the control rate observed in the selected data scope.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Primary outcome" htmlFor="pl-outcome">
              <Select id="pl-outcome" data-testid="pl-outcome" value={d.outcome} onChange={(e) => set({ outcome: e.target.value, base_rate_pct: "" })}>
                {(meta?.outcomes ?? ["visit", "conversion"]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
              </Select>
            </Field>
            <Field label="Baseline rate (%)" htmlFor="pl-base" hint={inp ? `Using ${pct(inp.base_rate, 3)} (${data.base_rate_source}).` : undefined}>
              <Input id="pl-base" data-testid="pl-base" type="number" min={0} max={100} step={0.1} placeholder="Observed control rate" value={d.base_rate_pct} onChange={(e) => set({ base_rate_pct: e.target.value })} />
            </Field>
            <Field label="Smallest relative lift worth detecting (%)" htmlFor="pl-mde" hint={inp ? `An absolute change of ${pp(inp.mde_absolute)}.` : undefined}>
              <Input id="pl-mde" data-testid="pl-mde" type="number" min={0.1} step={0.5} value={d.mde_pct} onChange={(e) => set({ mde_pct: e.target.value })} />
            </Field>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs font-medium text-secondary">Share assigned to treatment</span>
                <span className="text-sm font-semibold tabular" data-testid="pl-share-value">{d.share}%</span>
              </div>
              <Slider label="Share assigned to treatment" min={5} max={95} step={5} value={[d.share]} onValueChange={([v]) => set({ share: v })} data-testid="pl-share" />
            </div>
            <Field label="Significance level (two-sided)" htmlFor="pl-alpha">
              <Select id="pl-alpha" value={d.alpha} onChange={(e) => set({ alpha: Number(e.target.value) })}>
                <option value={0.1}>10%</option><option value={0.05}>5%</option><option value={0.01}>1%</option>
              </Select>
            </Field>
            <Field label="Power" htmlFor="pl-power" hint="Chance of detecting the lift if it is real.">
              <Select id="pl-power" value={d.power} onChange={(e) => set({ power: Number(e.target.value) })}>
                <option value={0.8}>80%</option><option value={0.9}>90%</option><option value={0.95}>95%</option>
              </Select>
            </Field>
            <Field label="Eligible users per day (optional)" htmlFor="pl-daily" hint="Used only to translate sample size into duration.">
              <Input id="pl-daily" data-testid="pl-daily" type="number" min={1} step={1000} placeholder="Not set" value={d.users_per_day} onChange={(e) => set({ users_per_day: e.target.value })} />
            </Field>
          </CardContent>
        </Card>

        <DataState loading={loading} error={error} hasData={!!data}>
          {data && r ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <StatTile label="Users required" value={compact(r.n_total)} sub={`${int(r.n_total)} in total`} testId="tile-required" />
                <StatTile label="Per arm" value={`${compact(r.n_treatment)} / ${compact(r.n_control)}`} sub="treatment / control" />
                <StatTile label="Duration" value={data.days_required != null ? `${int(data.days_required)} days` : "–"} sub={data.days_required != null ? `at ${int(inp.users_per_day)} eligible users per day` : "enter daily users to estimate"} testId="tile-duration" />
                <StatTile label="Cost of this allocation" value={`${num(data.allocation_cost, 2)}×`} sub={`users needed vs a 50/50 split (${compact(data.balanced_design.n_total)})`} testId="tile-allocation-cost" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Power to detect a {pct(inp.mde_relative, 1)} relative lift, by sample size</CardTitle>
                  <CardDescription>
                    Baseline {pct(inp.base_rate, 3)}, {pct(inp.treatment_share, 0)} of users treated, two-sided test at {pct(inp.alpha, 0)}. The vertical line marks the sample that reaches {pct(inp.power, 0)} power.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]" role="img" aria-label="Statistical power by total sample size" data-testid="power-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.power_curve.map((p: any) => ({ n: p.n_total, power: p.power * 100 }))} margin={{ top: 12, right: 24, bottom: 18, left: 8 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="n" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => compact(v)} tickLine={false} axisLine={{ stroke: "var(--axis)" }} label={{ value: "Total users in the experiment", position: "insideBottom", offset: -10 }} />
                        <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={48} />
                        <ReferenceLine y={inp.power * 100} stroke="var(--text-muted)" label={{ value: `target ${pct(inp.power, 0)}`, position: "insideBottomRight", fontSize: 10, fill: "var(--text-secondary)" }} />
                        <ReferenceLine x={r.n_total} stroke="var(--text-muted)" label={{ value: compact(r.n_total), position: "insideTopLeft", fontSize: 10, fill: "var(--text-secondary)" }} />
                        <Line dataKey="power" name="Power" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
                        <Tooltip cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }} content={<ChartTooltip title={(l) => `${int(l)} users`} format={(v) => `${v.toFixed(1)}%`} />} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 2xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>What the allocation costs</CardTitle>
                    <CardDescription>Same lift, significance and power; only the treatment share changes. Holding out fewer users protects revenue during the test but needs a larger experiment.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table data-testid="allocation-table">
                      <THead><TR><TH>Treatment share</TH><TH className="text-right">Total users</TH><TH className="text-right">Treatment</TH><TH className="text-right">Control</TH><TH className="text-right">vs 50/50</TH></TR></THead>
                      <TBody>
                        {data.allocations.map((a: any) => (
                          <TR key={a.treatment_share} className="tabular">
                            <TD className="font-medium">
                              {pct(a.treatment_share, 0)}
                              {Math.abs(a.treatment_share - 0.85) < 1e-9 ? <Badge className="ml-2">Criteo design</Badge> : null}
                              {Math.abs(a.treatment_share - inp.treatment_share) < 1e-9 ? <Badge variant="accent" className="ml-2">selected</Badge> : null}
                            </TD>
                            <TD className="text-right">{int(a.n_total)}</TD><TD className="text-right">{int(a.n_treatment)}</TD><TD className="text-right">{int(a.n_control)}</TD>
                            <TD className="text-right">{num(a.relative_to_balanced, 2)}×</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card data-testid="observed-design">
                  <CardHeader>
                    <CardTitle>For comparison: the experiment in this data scope</CardTitle>
                    <CardDescription>What the existing test was able to detect for {OUTCOME_LABEL[data.outcome].toLowerCase()}s, at its own size and allocation.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm tabular">
                      <dt className="text-secondary">Users</dt><dd className="text-right font-medium">{int(obs.n_total)}</dd>
                      <dt className="text-secondary">Treatment share</dt><dd className="text-right font-medium">{pct(obs.treatment_share, 1)}</dd>
                      <dt className="text-secondary">Control rate</dt><dd className="text-right font-medium">{pct(obs.base_rate, 3)}</dd>
                      <dt className="text-secondary">Minimum detectable effect at {pct(inp.power, 0)} power</dt><dd className="text-right font-medium">{pp(obs.mde_absolute)} ({pct(obs.mde_relative, 1)} relative)</dd>
                      <dt className="text-secondary">Effect actually observed (unadjusted)</dt><dd className="text-right font-medium">{pp(obs.observed_effect)}</dd>
                    </dl>
                    <p className="mt-3 text-[13px] leading-relaxed text-secondary">
                      The observed effect is {num(obs.observed_effect / obs.mde_absolute, 0)} times the minimum detectable effect, which is why significance alone says little here.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Callout tone="info" title="Assumptions behind these numbers">
                {data.test}. One primary outcome, one look at the data at the end, users randomised independently, and a baseline that stays at the entered rate. Peeking early, several primary metrics or clustered users all need a larger sample than shown.
              </Callout>
            </div>
          ) : null}
        </DataState>
      </div>
    </>
  );
}
