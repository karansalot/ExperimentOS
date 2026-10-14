"use client";

import * as React from "react";
import Link from "next/link";
import { CurveChart } from "@/components/charts/curve-chart";
import { SensitivityHeatmap, Tornado } from "@/components/charts/sensitivity";
import { Callout, DataState, NextStep, PageHeader, StatTile } from "@/components/page";
import { SavedScenarios } from "@/components/saved-scenarios";
import { ScenarioForm, useScenarioResult } from "@/components/scenario-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compact, int, money, num, pct, pp } from "@/lib/format";
import { Term } from "@/components/term";
import { CsvButton } from "@/components/csv-button";

export default function SimulatorPage() {
  const { data: r, error, loading } = useScenarioResult<any>("/simulate");
  const s = r?.scenario;
  const sel = r?.selected;
  const rec = r?.recommendation;
  const be = r?.break_even;
  const rule = r?.targeting_rule;
  const cutoff = (v: number | null | undefined) =>
    v == null ? "–" : rule?.score_kind === "predicted uplift" ? pp(v, 3) : pct(v, 2);

  return (
    <>
      <PageHeader
        title="Targeting simulator"
        description="Who should receive the treatment, and is it worth it? Combine the held-out uplift curves with your own cost and value assumptions."
        meta={r?.meta}
        summary={
          r
            ? [
                rec.action === "hold"
                  ? <>With your numbers, <strong>don&apos;t treat anyone</strong>: no group of users responds enough to pay for the treatment.</>
                  : rec.action === "roll_out"
                  ? <>With your numbers, <strong>treat everyone</strong>: even the average user responds enough to pay for it.</>
                  : <>With your numbers, <strong>treat the top {rec.targeting_pct.toFixed(0)}%</strong> of users by predicted uplift, for an estimated profit of {money(rec.profit)} ({money(rec.profit_low)} to {money(rec.profit_high)}).</>,
                <>Treating someone pays off only if their <Term k="uplift">uplift</Term> beats cost ÷ value = {pp(be.required_effect_per_targeted_user, 2)}; the average user gives {pp(be.population_average_effect, 2)}.</>,
                <>All money figures come from your scenario inputs. The dataset has no prices or costs.</>,
              ]
            : null
        }
      />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card className="no-print self-start xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle>Scenario assumptions</CardTitle>
            <CardDescription>The dataset has no cost or revenue fields. Every monetary input here is yours.</CardDescription>
          </CardHeader>
          <CardContent><ScenarioForm /></CardContent>
        </Card>

        <DataState loading={loading} error={error} hasData={!!r}>
          {r ? (
            <div className="flex flex-col gap-4">
              <Callout tone="warning" title="Scenario estimates, not measured financial results" testId="scenario-disclaimer">
                Incremental {s.outcome}s are estimated from {int(r.meta.evaluation_rows)} held-out users and scaled to a population of {int(s.population)}. Cost, value and profit follow from your scenario assumptions.
              </Callout>

              {r.budget.capped_by_budget ? (
                <Callout tone="info" title={`Budget caps coverage at ${r.budget.max_affordable_pct.toFixed(0)}%`} testId="budget-callout">
                  You asked for {r.budget.requested_pct.toFixed(0)}%, but a budget of {money(r.budget.budget)} at {num(s.cost_per_user, 2)} per user affords {r.budget.max_affordable_pct.toFixed(0)}%. Results below use the capped coverage.
                </Callout>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <StatTile label="Users treated" value={compact(sel.targeted_users)} sub={`${sel.targeting_pct.toFixed(0)}% coverage · ${s.strategy_name}`} testId="tile-treated" />
                <StatTile label={`Expected incremental ${s.outcome}s`} value={compact(sel.incremental_outcomes)} sub={`95% interval ${compact(sel.incremental_low)} to ${compact(sel.incremental_high)}`} testId="tile-incremental" />
                <StatTile label="Estimated treatment cost" value={money(sel.treatment_cost)} sub={sel.cost_per_incremental_outcome != null ? `${num(sel.cost_per_incremental_outcome, 2)} per incremental ${s.outcome}` : "no incremental outcomes"} testId="tile-cost" />
                <StatTile
                  label="Scenario profit"
                  value={money(sel.profit)}
                  sub={<>95% interval {money(sel.profit_low)} to {money(sel.profit_high)}{sel.roi != null ? <> · ROI {pct(sel.roi, 0)}</> : null}{sel.prob_profit_positive != null ? <> · P(profit &gt; 0) {pct(sel.prob_profit_positive, 0)}</> : null}</>}
                  testId="tile-profit"
                />
              </div>

              <Card data-testid="recommendation">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>
                      Recommended under these assumptions:{" "}
                      {rec.action === "hold" ? "do not treat" : rec.action === "roll_out" ? "treat everyone" : `target the top ${rec.targeting_pct.toFixed(0)}%`}
                    </CardTitle>
                    <Button asChild variant="outline" size="sm"><Link href="/brief">Open decision brief</Link></Button>
                  </div>
                  <CardDescription>
                    Coverage that maximises {rec.criterion} for {s.strategy_name}{rec.at_budget_limit ? ", limited by the budget" : ""}.{" "}
                    {rec.action === "hold"
                      ? `No coverage level has positive ${rec.criterion}.`
                      : `Scenario profit ${money(rec.profit)} (95% interval ${money(rec.profit_low)} to ${money(rec.profit_high)}) from ${compact(rec.incremental_outcomes)} incremental ${s.outcome}s at a cost of ${money(rec.treatment_cost)}.`}{" "}
                    {rec.coverage_selected_on === "validation" ? "The coverage was chosen on the validation split; these figures are measured on the separate test split." : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CurveChart
                    ariaLabel="Scenario profit by share of users targeted, per strategy"
                    x={r.profit_curves.targeting_pct}
                    series={Object.entries<any>(r.profit_curves.strategies).map(([id, v]) => ({ id, name: v.name, values: v.profit, low: v.profit_low, high: v.profit_high }))}
                    highlight={s.strategy_resolved}
                    yLabel="Scenario profit"
                    yFormat={(v) => compact(v)}
                    tooltipFormat={(v) => money(v)}
                    zeroLine
                    markers={[
                      { x: sel.targeting_pct, label: `selected ${sel.targeting_pct.toFixed(0)}%` },
                      ...(r.budget.budget != null && r.budget.max_affordable_pct < 100 && Math.abs(r.budget.max_affordable_pct - sel.targeting_pct) > 3 ? [{ x: r.budget.max_affordable_pct, label: "budget cap" }] : []),
                    ]}
                  />
                  {rule?.score_kind ? (
                    <div className="mt-4 rounded-md border border-border p-3 text-[13px] leading-relaxed" data-testid="targeting-rule">
                      <div className="font-medium">Deployable targeting rule</div>
                      <p className="mt-0.5 text-secondary">
                        Treat a user when the {s.strategy_name} model’s {rule.score_kind} is at least{" "}
                        <span className="font-medium tabular text-foreground">{cutoff(rule.selected_cutoff)}</span> (your {sel.targeting_pct.toFixed(0)}% coverage)
                        {rule.recommended_cutoff != null ? <> or <span className="font-medium tabular text-foreground">{cutoff(rule.recommended_cutoff)}</span> (recommended {rec.targeting_pct.toFixed(0)}%)</> : null}.
                        Thresholds are read from the held-out test split.
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <SavedScenarios result={r} busy={loading} />

              <Card>
                <CardHeader>
                  <CardTitle>Strategy comparison at {sel.targeting_pct.toFixed(0)}% coverage</CardTitle>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardDescription>Same budget and coverage, different ways of choosing who is treated. The last columns show each strategy at its own best coverage.</CardDescription>
                    <CsvButton
                      filename="strategy-comparison.csv"
                      columns={["strategy", "coverage_pct", "incremental_outcomes", "treatment_cost", "profit", "profit_low", "profit_high", "roi", "best_coverage_pct", "profit_at_best", "feasible"]}
                      rows={r.strategies.map((x: any) => [x.name, x.targeting_pct, x.incremental_outcomes, x.treatment_cost, x.profit, x.profit_low, x.profit_high, x.roi ?? "", x.optimum?.targeting_pct ?? "", x.optimum?.profit ?? "", x.feasible])}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <Table data-testid="strategy-table">
                    <THead>
                      <TR><TH>Strategy</TH><TH className="text-right">Coverage</TH><TH className="text-right">Incremental {s.outcome}s</TH><TH className="text-right">Cost</TH><TH className="text-right">Profit</TH><TH className="text-right">95% interval</TH><TH className="text-right">ROI</TH><TH className="text-right">Best coverage</TH><TH className="text-right">Profit at best</TH></TR>
                    </THead>
                    <TBody>
                      {r.strategies.map((x: any) => (
                        <TR key={x.id} className="tabular" data-strategy={x.id}>
                          <TD>
                            <span className="font-medium">{x.name}</span>
                            {x.id === s.strategy_resolved ? <Badge variant="accent" className="ml-2">selected</Badge> : null}
                            {!x.feasible ? <Badge variant="warning" className="ml-2">over budget</Badge> : null}
                          </TD>
                          <TD className="text-right">{x.targeting_pct.toFixed(0)}%</TD>
                          <TD className="text-right">{int(x.incremental_outcomes)}</TD>
                          <TD className="text-right">{money(x.treatment_cost)}</TD>
                          <TD className="text-right font-medium">{money(x.profit)}</TD>
                          <TD className="text-right text-secondary">{x.id === "none" ? "–" : `${money(x.profit_low)} to ${money(x.profit_high)}`}</TD>
                          <TD className="text-right">{x.roi != null ? pct(x.roi, 0) : "–"}</TD>
                          <TD className="text-right text-secondary">{x.optimum ? `${x.optimum.targeting_pct.toFixed(0)}%` : "–"}</TD>
                          <TD className="text-right text-secondary">{x.optimum ? money(x.optimum.profit) : "–"}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 2xl:grid-cols-2">
                <Card data-testid="break-even">
                  <CardHeader>
                    <CardTitle>Break-even conditions</CardTitle>
                    <CardDescription>Treating a user pays off only if the treatment raises their {s.outcome} probability by more than cost ÷ value.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm tabular">
                      <dt className="text-secondary">Required effect per treated user (cost ÷ value)</dt><dd className="text-right font-medium">{pp(be.required_effect_per_targeted_user, 2)}</dd>
                      <dt className="text-secondary">Average effect among the {sel.targeting_pct.toFixed(0)}% targeted</dt><dd className="text-right font-medium">{pp(be.average_effect_in_targeted_group, 2)}</dd>
                      <dt className="text-secondary">Average effect across everyone</dt><dd className="text-right font-medium">{pp(be.population_average_effect, 2)}</dd>
                      <dt className="text-secondary">Value per {s.outcome} at which this coverage breaks even</dt><dd className="text-right font-medium">{num(be.break_even_value_per_outcome, 2)}</dd>
                      <dt className="text-secondary">Highest cost per user this coverage can bear</dt><dd className="text-right font-medium">{num(be.break_even_cost_per_user, 3)}</dd>
                      <dt className="text-secondary">Value per {s.outcome} at which treating everyone breaks even</dt><dd className="text-right font-medium">{num(be.treat_everyone_break_even_value, 2)}</dd>
                    </dl>
                    <p className="mt-3 text-[13px] leading-relaxed text-secondary">
                      Treating everyone is {be.treat_everyone_is_profitable ? "profitable" : "not profitable"} at these assumptions, because the population-average effect is {be.treat_everyone_is_profitable ? "above" : "below"} the required effect.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>What moves the result most</CardTitle>
                    <CardDescription>Profit at the selected coverage when one input changes and the others stay fixed.</CardDescription>
                  </CardHeader>
                  <CardContent><Tornado rows={r.sensitivity.tornado} base={r.sensitivity.base_profit} /></CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Sensitivity to cost and value assumptions</CardTitle>
                  <CardDescription>Scenario profit as both assumptions move together, from half to double your inputs.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="selected">
                    <TabsList>
                      <TabsTrigger value="selected">At selected coverage</TabsTrigger>
                      <TabsTrigger value="optimum">At re-optimised coverage</TabsTrigger>
                    </TabsList>
                    <TabsContent value="selected" className="pt-3">
                      <SensitivityHeatmap multipliers={r.sensitivity.multipliers} grid={r.sensitivity.grid_rows_cost_cols_value} baseCost={s.cost_per_user} baseValue={s.value_per_outcome} field="profit_at_selected" />
                    </TabsContent>
                    <TabsContent value="optimum" className="pt-3">
                      <SensitivityHeatmap multipliers={r.sensitivity.multipliers} grid={r.sensitivity.grid_rows_cost_cols_value} baseCost={s.cost_per_user} baseValue={s.value_per_outcome} field="profit_at_optimum" />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>How to read these numbers</CardTitle></CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-secondary">
                    {r.caveats.map((c: string) => <li key={c}>{c}</li>)}
                  </ul>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DataState>
      </div>
      <NextStep />
    </>
  );
}
