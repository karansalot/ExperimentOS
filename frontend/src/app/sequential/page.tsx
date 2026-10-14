"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Callout, DataState, Legend, PageHeader, StatTile } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { pct } from "@/lib/format";

const COLOR: Record<string, string> = { naive: "var(--series-response)", pocock: "var(--series-two-model)", obrien_fleming: "var(--series-t-learner)" };
const SHORT: Record<string, string> = { naive: "Naive peeking", pocock: "Pocock", obrien_fleming: "O'Brien-Fleming" };

export default function SequentialPage() {
  const [looks, setLooks] = React.useState(10);
  const [alpha, setAlpha] = React.useState(0.05);
  const [power, setPower] = React.useState(0.8);
  const [data, setData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/sequential", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n_looks: looks, alpha, power }) });
        const json = await res.json();
        if (!res.ok) throw new Error("Invalid design");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [looks, alpha, power]);

  const d = data ? Object.fromEntries(data.designs.map((x: any) => [x.id, x])) : null;

  return (
    <>
      <PageHeader
        title="Sequential testing lab"
        description="Why you can't keep checking an experiment until it looks significant, and how alpha-spending boundaries let you stop early safely."
      >
        <div className="w-56">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs font-medium text-secondary">Interim looks</span>
            <span className="text-sm font-semibold tabular" data-testid="looks-value">{looks}</span>
          </div>
          <Slider label="Interim looks" min={1} max={30} step={1} value={[looks]} onValueChange={([v]) => setLooks(v)} />
        </div>
        <Field label="Significance level" htmlFor="sq-alpha">
          <Select id="sq-alpha" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="w-28">
            <option value={0.1}>10%</option><option value={0.05}>5%</option><option value={0.01}>1%</option>
          </Select>
        </Field>
        <Field label="Design power" htmlFor="sq-power">
          <Select id="sq-power" value={power} onChange={(e) => setPower(Number(e.target.value))} className="w-28">
            <option value={0.8}>80%</option><option value={0.9}>90%</option>
          </Select>
        </Field>
      </PageHeader>
      <DataState loading={loading} error={error} hasData={!!data}>
        {data && d ? (
          <div className="flex flex-col gap-4">
            <Callout tone="info" title="A design simulation, not a re-analysis of Criteo">{data.method} {data.note}</Callout>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label={`False positives with naive peeking (${looks} looks)`} value={pct(d.naive.false_positive_rate, 1)} sub={`promised: ${pct(alpha, 0)}`} testId="tile-naive-fpr" />
              <StatTile label="With an O'Brien-Fleming boundary" value={pct(d.obrien_fleming.false_positive_rate, 1)} sub={`power ${pct(d.obrien_fleming.power, 0)} · final threshold z = ${d.obrien_fleming.boundary_z.at(-1).toFixed(2)}`} testId="tile-obf-fpr" />
              <StatTile label="Average sample used when the effect is real" value={pct(d.obrien_fleming.expected_sample_fraction, 0)} sub="O'Brien-Fleming, of the planned fixed-horizon sample" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>The cost of peeking</CardTitle>
                  <CardDescription>Chance of declaring a winner in an A/A test (no true effect) if you stop the first time p &lt; {alpha} across this many looks.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]" role="img" aria-label="False positive rate by number of looks" data-testid="fpr-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.naive_fpr_by_looks.map((c: any) => ({ looks: c.looks, fpr: c.false_positive_rate * 100 }))} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="looks" type="number" domain={[1, 50]} ticks={[1, 10, 20, 30, 40, 50]} tickLine={false} axisLine={{ stroke: "var(--axis)" }} label={{ value: "Number of looks", position: "insideBottom", offset: -10 }} />
                        <YAxis tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={44} />
                        <ReferenceLine y={alpha * 100} stroke="var(--text-muted)" label={{ value: `promised ${pct(alpha, 0)}`, position: "insideTopRight", fontSize: 10, fill: "var(--text-secondary)" }} />
                        <Line dataKey="fpr" name="False-positive rate" stroke="var(--series-response)" strokeWidth={2} dot={{ r: 3, fill: "var(--series-response)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
                        <Tooltip cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }} content={<ChartTooltip title={(l) => `${l} looks`} format={(v) => `${v.toFixed(1)}%`} />} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Stopping boundaries</CardTitle>
                  <CardDescription>|z| a test must exceed at each look. O&apos;Brien-Fleming is nearly impossible to cross early and close to the usual 1.96 at the end; Pocock spends alpha evenly.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Legend items={data.designs.map((x: any) => ({ label: SHORT[x.id], color: COLOR[x.id] }))} />
                  <div className="mt-2 h-[256px]" role="img" aria-label="Critical z value at each look by design" data-testid="boundary-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={d.naive.boundary_z.map((_: number, k: number) => ({ look: k + 1, ...Object.fromEntries(data.designs.map((x: any) => [x.id, x.boundary_z[k]])) }))} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="look" type="number" domain={[1, looks]} allowDecimals={false} tickLine={false} axisLine={{ stroke: "var(--axis)" }} label={{ value: "Look", position: "insideBottom", offset: -10 }} />
                        <YAxis domain={[0, "auto"]} tickLine={false} axisLine={false} width={40} />
                        {data.designs.map((x: any) => (
                          <Line key={x.id} dataKey={x.id} name={SHORT[x.id]} stroke={COLOR[x.id]} strokeWidth={2} dot={looks <= 15 ? { r: 3, fill: COLOR[x.id], stroke: "var(--surface)", strokeWidth: 2 } : false} isAnimationActive={false} />
                        ))}
                        <Tooltip cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }} content={<ChartTooltip title={(l) => `Look ${l}`} format={(v) => `|z| ≥ ${v.toFixed(2)}`} names={SHORT} />} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Design comparison</CardTitle>
                <CardDescription>Error rates measured on fresh simulations, not the ones used to calibrate the boundaries. Power and stopping are for the effect the fixed-horizon test is powered to detect.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table data-testid="sequential-table">
                  <THead><TR><TH>Design</TH><TH className="text-right">False-positive rate</TH><TH className="text-right">Power</TH><TH className="text-right">Average sample used</TH><TH className="text-right">Stopped by halfway</TH></TR></THead>
                  <TBody>
                    {data.designs.map((x: any) => (
                      <TR key={x.id} className="tabular">
                        <TD><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: COLOR[x.id] }} /><span className="font-medium">{x.name}</span></span></TD>
                        <TD className="text-right font-medium">{pct(x.false_positive_rate, 1)}</TD>
                        <TD className="text-right">{pct(x.power, 1)}</TD>
                        <TD className="text-right">{pct(x.expected_sample_fraction, 0)}</TD>
                        <TD className="text-right">{pct(x.stop_by_look[Math.max(0, Math.floor(looks / 2) - 1)], 0)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  Naive peeking looks more powerful only because it rejects far too often; its power is not comparable to the others. {data.inputs.sims.toLocaleString("en-US")} simulated experiments per design, seed {data.inputs.seed}.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DataState>
    </>
  );
}
