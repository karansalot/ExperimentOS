"use client";

import * as React from "react";
import { ForestPlot } from "@/components/charts/forest";
import { RateBars } from "@/components/charts/rate-bars";
import { Callout, DataState, Legend, PageHeader, StatTile, StatusBadge } from "@/components/page";
import { useApp } from "@/components/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi, withScope } from "@/lib/api";
import { OUTCOME_LABEL, int, pct, pp, pval, signedPct } from "@/lib/format";

const ESTIMATOR_SHORT: Record<string, string> = {
  "Unadjusted difference in proportions": "Unadjusted",
  "Regression adjustment (Lin 2013, HC1)": "Regression-adjusted",
  "AIPW / doubly robust (cross-fitted gradient boosting)": "Doubly robust (AIPW)",
};

export default function OverviewPage() {
  const { scope } = useApp();
  const { data, error, loading } = useApi<any>(scope ? withScope("/overview", scope) : null);
  const e = data?.experiment;
  const outcomes: string[] = e ? Object.keys(e.outcomes) : [];

  return (
    <>
      <PageHeader
        title="Experiment overview"
        description="Did assignment to treatment change behaviour, by how much, and how sure are we? Intent-to-treat comparison of the treatment and control arms."
        meta={data?.meta}
      />
      <DataState loading={loading} error={error} hasData={!!data}>
        {data ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Callout tone={e.srm.mismatch_detected ? "critical" : "good"} title={e.srm.mismatch_detected ? "Sample ratio mismatch detected" : "Sample ratio matches the design"} testId="srm-callout">
                {pct(e.srm.observed_treatment_share, 3)} treated against a documented {pct(e.srm.expected_treatment_share, 0)} design (χ² p = {pval(e.srm.p_value)}).
              </Callout>
              <Callout
                tone={data.balance_verdict.status === "pass" ? "good" : data.balance_verdict.status === "caution" ? "warning" : "critical"}
                title={data.balance_verdict.status === "pass" ? "Arms are balanced on features" : "Arms are not perfectly comparable"}
                testId="balance-callout"
              >
                {data.balance_verdict.headline} Read the adjusted estimates below alongside the raw difference.
              </Callout>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Users in experiment" value={int(e.n_users)} sub={`${int(e.arms[0].n_users)} treatment · ${int(e.arms[1].n_users)} control`} testId="tile-users" />
              <StatTile label="Treatment share" value={pct(e.srm.observed_treatment_share, 2)} sub={`design ${pct(e.srm.expected_treatment_share, 0)}`} />
              {outcomes.map((o) => (
                <StatTile
                  key={o}
                  label={`${OUTCOME_LABEL[o]} effect (unadjusted)`}
                  value={pp(e.outcomes[o].absolute_effect)}
                  sub={`95% CI ${pp(e.outcomes[o].ci_low)} to ${pp(e.outcomes[o].ci_high)} · ${signedPct(e.outcomes[o].relative_effect)} relative`}
                  testId={`tile-effect-${o}`}
                />
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-5">
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>Outcome rates by arm</CardTitle>
                  <CardDescription>Share of users with each outcome. The two outcomes differ by an order of magnitude, so each has its own scale.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <Legend items={[{ label: "Control", color: "var(--series-control)", shape: "rect" }, { label: "Treatment", color: "var(--series-treatment)", shape: "rect" }]} />
                  {outcomes.map((o) => (
                    <RateBars key={o} title={`${OUTCOME_LABEL[o]} rate`} control={e.outcomes[o].rate_control} treatment={e.outcomes[o].rate_treatment} digits={o === "visit" ? 2 : 3} />
                  ))}
                </CardContent>
              </Card>

              <Card className="xl:col-span-3">
                <CardHeader>
                  <CardTitle>Average treatment effect, three estimators</CardTitle>
                  <CardDescription>
                    Percentage-point change in the outcome rate with 95% confidence intervals. If assignment were cleanly random, all three would agree up to noise.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue={outcomes[0]}>
                    <TabsList>
                      {outcomes.map((o) => (
                        <TabsTrigger key={o} value={o}>{OUTCOME_LABEL[o]}</TabsTrigger>
                      ))}
                    </TabsList>
                    {outcomes.map((o) => {
                      const est = data.adjusted?.[o]?.estimators ?? [];
                      const dr = est.find((x: any) => x.method.startsWith("AIPW"));
                      return (
                        <TabsContent key={o} value={o} className="pt-3">
                          <ForestPlot
                            ariaLabel={`${OUTCOME_LABEL[o]} treatment effect by estimator`}
                            format={(v) => pp(v)}
                            tickFormat={(v) => `${(v * 100).toFixed(o === "visit" ? 1 : 2)}`}
                            rows={est.map((x: any, i: number) => ({ key: x.method, label: ESTIMATOR_SHORT[x.method] ?? x.method, value: x.estimate, low: x.ci_low, high: x.ci_high, muted: i === 0 && false }))}
                          />
                          <p className="mt-1 text-[11px] text-muted">Axis: percentage points.</p>
                          {dr ? (
                            <p className="mt-3 text-[13px] leading-relaxed text-secondary" data-testid={`adjusted-note-${o}`}>
                              The covariate-adjusted estimate is {pp(dr.estimate)}, {pct(Math.abs(dr.relative_to_unadjusted), 0)}{" "}
                              {dr.relative_to_unadjusted < 0 ? "below" : "above"} the raw difference. The direction is the same under every estimator; the size is not.
                            </p>
                          ) : null}
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Statistical uncertainty</CardTitle>
                <CardDescription>
                  Two-sided pooled z-test per outcome; Newcombe interval for the difference; log-scale interval for relative lift. Holm adjustment covers the two outcomes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR>
                      <TH>Outcome</TH><TH className="text-right">Control</TH><TH className="text-right">Treatment</TH><TH className="text-right">Absolute effect</TH>
                      <TH className="text-right">95% CI</TH><TH className="text-right">Relative lift</TH><TH className="text-right">95% CI</TH>
                      <TH className="text-right">z</TH><TH className="text-right">p</TH><TH className="text-right">p (Holm)</TH><TH className="text-right">MDE at 80% power</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {outcomes.map((o) => {
                      const x = e.outcomes[o];
                      return (
                        <TR key={o} className="tabular">
                          <TD className="font-medium">{OUTCOME_LABEL[o]}</TD>
                          <TD className="text-right">{pct(x.rate_control, 3)}</TD>
                          <TD className="text-right">{pct(x.rate_treatment, 3)}</TD>
                          <TD className="text-right font-medium">{pp(x.absolute_effect)}</TD>
                          <TD className="text-right">{pp(x.ci_low)} to {pp(x.ci_high)}</TD>
                          <TD className="text-right">{signedPct(x.relative_effect)}</TD>
                          <TD className="text-right">{signedPct(x.relative_ci_low)} to {signedPct(x.relative_ci_high)}</TD>
                          <TD className="text-right">{x.z_statistic.toFixed(1)}</TD>
                          <TD className="text-right">{pval(x.p_value)}</TD>
                          <TD className="text-right">{pval(x.p_value_holm)}</TD>
                          <TD className="text-right">{pp(x.mde.mde_absolute)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  With {int(e.n_users)} users almost any difference is statistically significant. The decision-relevant quantities are the effect size and its interval, not the p-value.
                </p>
              </CardContent>
            </Card>

            <Card data-testid="bayes-card">
              <CardHeader>
                <CardTitle>Bayesian read-out</CardTitle>
                <CardDescription>
                  The questions stakeholders actually ask, answered with a Beta-Binomial model (uniform priors, {int(data.bayes.visit.draws)} posterior draws). With this much data the prior is irrelevant and the credible interval matches the confidence interval.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR><TH>Outcome</TH><TH className="text-right">P(treatment better)</TH><TH className="text-right">Lift, 95% credible interval</TH><TH className="text-right">Relative lift, 95% credible interval</TH><TH className="text-right">P(relative lift &gt; 10%)</TH><TH className="text-right">P(relative lift &gt; 30%)</TH><TH className="text-right">Expected loss if we ship</TH></TR>
                  </THead>
                  <TBody>
                    {outcomes.map((o) => {
                      const b = data.bayes[o];
                      return (
                        <TR key={o} className="tabular">
                          <TD className="font-medium">{OUTCOME_LABEL[o]}</TD>
                          <TD className="text-right font-medium">{b.prob_treatment_better > 0.9999 ? "> 99.99%" : pct(b.prob_treatment_better, 2)}</TD>
                          <TD className="text-right">{pp(b.absolute_lift_ci[0])} to {pp(b.absolute_lift_ci[1])}</TD>
                          <TD className="text-right">{signedPct(b.relative_lift_ci[0])} to {signedPct(b.relative_lift_ci[1])}</TD>
                          <TD className="text-right">{pct(b.prob_relative_lift_above["0.1"], 1)}</TD>
                          <TD className="text-right">{pct(b.prob_relative_lift_above["0.3"], 1)}</TD>
                          <TD className="text-right">{pp(b.expected_loss_ship_treatment, 4)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  These are unadjusted posteriors, so they inherit the arm imbalance discussed above; the covariate-adjusted effect is the more conservative planning number.
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Treatment and control breakdown</CardTitle>
                  <CardDescription>
                    Only {pct(e.exposure.exposure_rate_treatment, 1)} of treated users were actually exposed to advertising, and no control user was. Exposure is a post-treatment outcome, so arms are compared as assigned.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead>
                      <TR><TH>Arm</TH><TH className="text-right">Users</TH><TH className="text-right">Exposed</TH><TH className="text-right">Visits</TH><TH className="text-right">Conversions</TH></TR>
                    </THead>
                    <TBody>
                      {e.arms.map((a: any) => (
                        <TR key={a.arm} className="tabular">
                          <TD className="font-medium capitalize">{a.arm}</TD>
                          <TD className="text-right">{int(a.n_users)}</TD>
                          <TD className="text-right">{int(a.exposures)} <span className="text-muted">({pct(a.exposure_rate, 2)})</span></TD>
                          <TD className="text-right">{int(a.visits)} <span className="text-muted">({pct(a.visit_rate, 2)})</span></TD>
                          <TD className="text-right">{int(a.conversions)} <span className="text-muted">({pct(a.conversion_rate, 3)})</span></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <div className="mt-4 text-[12px] leading-relaxed text-secondary">
                    <span className="font-medium text-foreground">Implied effect per exposed user</span> (Wald estimator, valid only if assignment affects outcomes solely through exposure):{" "}
                    {outcomes.map((o, i) => {
                      const c = e.exposure.effect_per_exposed_user[o];
                      return c.identified ? (
                        <span key={o}>{i ? "; " : ""}{OUTCOME_LABEL[o].toLowerCase()} {pp(c.cace, 1)} (95% CI {pp(c.ci_low, 1)} to {pp(c.ci_high, 1)})</span>
                      ) : null;
                    })}.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Dataset profile</CardTitle>
                  <CardDescription>
                    Figures verified against the downloaded file rather than quoted from the dataset card, which contradicts itself in places.{" "}
                    <StatusBadge ok={data.quality_passed} okLabel="All data quality checks pass" failLabel="Data quality check failed" />
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead><TR><TH>Property</TH><TH>Dataset card says</TH><TH>Verified in this scope</TH></TR></THead>
                    <TBody>
                      {data.card_comparison.map((c: any) => (
                        <TR key={c.field}>
                          <TD className="font-medium">{c.field}</TD><TD className="text-secondary">{c.card_statement}</TD><TD className="tabular">{c.verified}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-secondary">Column roles ({data.columns.length})</summary>
                    <Table className="mt-2">
                      <TBody>
                        {data.columns.slice(12).map((c: any) => (
                          <TR key={c.column}><TD className="font-mono">{c.column}</TD><TD className="text-secondary">{c.role}</TD></TR>
                        ))}
                        <TR><TD className="font-mono">f0 … f11</TD><TD className="text-secondary">{data.columns[0].role}</TD></TR>
                      </TBody>
                    </Table>
                  </details>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </DataState>
    </>
  );
}
