"use client";

import * as React from "react";
import { ForestPlot } from "@/components/charts/forest";
import { Callout, DataState, PageHeader, StatTile, StatusBadge } from "@/components/page";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useApi, withScope } from "@/lib/api";
import { OUTCOME_LABEL, int, num, pct, pp, pval, signedPct } from "@/lib/format";

export default function DiagnosticsPage() {
  const { scope, meta } = useApp();
  const [outcome, setOutcome] = React.useState("visit");
  const [feature, setFeature] = React.useState("f0");
  const [segBasis, setSegBasis] = React.useState("unadjusted");
  const diag = useApi<any>(scope ? withScope("/diagnostics", scope) : null);
  const ov = useApi<any>(scope ? withScope("/overview", scope) : null);
  const vr = ov.data?.variance_reduction;
  const seg = useApi<any>(scope ? withScope(`/segments?outcome=${outcome}`, scope) : null);
  const d = diag.data;
  const f = seg.data?.features.find((x: any) => x.feature === feature);
  const adj = segBasis === "adjusted" && !!seg.data?.has_adjusted_effects;
  const c2 = d?.adjusted?.classifier_two_sample_test;
  const om = d?.adjusted?.omnibus_f_test;

  return (
    <>
      <PageHeader
        title="Statistical diagnostics"
        description="Can the comparison be trusted? Randomisation checks, hypothesis tests, and how the effect differs across segments."
        meta={d?.meta}
      />
      <DataState loading={diag.loading} error={diag.error} hasData={!!d}>
        {d ? (
          <div className="flex flex-col gap-4">
            <Callout
              tone={d.verdict.status === "pass" ? "good" : d.verdict.status === "caution" ? "warning" : "critical"}
              title={d.verdict.headline}
              testId="balance-verdict"
            >
              Largest standardised mean difference {num(d.verdict.max_abs_smd, 3)} ({d.verdict.worst_feature}); {d.verdict.features_significant_after_holm} of{" "}
              {d.verdict.n_features} features differ between arms after Holm correction. The file pools several tests and was sub-sampled non-uniformly for privacy, either of which can produce this pattern.
            </Callout>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Sample ratio mismatch"
                value={d.srm.mismatch_detected ? "Detected" : "None"}
                sub={`χ² = ${num(d.srm.chi_square, 4)}, p = ${pval(d.srm.p_value)} (alarm at p < ${d.srm.alpha})`}
                testId="tile-srm"
              />
              <StatTile label="Largest |SMD|" value={num(d.verdict.max_abs_smd, 3)} sub={`conventional threshold ${d.verdict.smd_threshold}`} />
              <StatTile
                label="Assignment predictability (AUC)"
                value={c2 ? num(c2.auc, 3) : "–"}
                sub={c2 ? `0.500 = arms indistinguishable · p ${pval(c2.p_value)}` : "not computed"}
                testId="tile-c2st"
              />
              <StatTile label="Omnibus balance F-test" value={om ? num(om.f_statistic, 1) : "–"} sub={om ? `R² = ${om.r_squared.toExponential(1)} · p ${pval(om.p_value)}` : "not computed"} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Covariate balance</CardTitle>
                  <CardDescription>
                    Standardised mean difference (treatment minus control, in pooled standard deviations) for each pre-treatment feature. Under clean randomisation these scatter tightly around zero.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ForestPlot
                    ariaLabel="Standardised mean difference by feature"
                    format={(v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3)}
                    tickFormat={(v) => v.toFixed(2)}
                    references={[{ value: -0.1, label: "−0.1" }, { value: 0.1, label: "+0.1" }]}
                    labelWidth={60}
                    valueWidth={70}
                    rows={[...d.balance].sort((a: any, b: any) => Math.abs(b.std_mean_diff) - Math.abs(a.std_mean_diff)).map((r: any) => ({ key: r.feature, label: r.feature, value: r.std_mean_diff }))}
                  />
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-secondary">Balance table</summary>
                    <Table className="mt-2">
                      <THead><TR><TH>Feature</TH><TH className="text-right">Mean (control)</TH><TH className="text-right">Mean (treatment)</TH><TH className="text-right">SMD</TH><TH className="text-right">Variance ratio</TH><TH className="text-right">p (Holm)</TH></TR></THead>
                      <TBody>
                        {d.balance.map((r: any) => (
                          <TR key={r.feature} className="tabular">
                            <TD className="font-mono">{r.feature}</TD><TD className="text-right">{num(r.mean_control, 4)}</TD><TD className="text-right">{num(r.mean_treatment, 4)}</TD>
                            <TD className="text-right">{num(r.std_mean_diff, 4)}</TD><TD className="text-right">{num(r.variance_ratio, 3)}</TD><TD className="text-right">{pval(r.p_value_holm)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </details>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Does adjustment change the answer?</CardTitle>
                  <CardDescription>
                    The same effect estimated three ways. A material shift after adjusting for features means the raw difference mixes the treatment effect with differences in who is in each arm.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {d.adjusted ? (
                    <Table>
                      <THead><TR><TH>Outcome</TH><TH>Estimator</TH><TH className="text-right">Effect</TH><TH className="text-right">95% CI</TH><TH className="text-right">vs unadjusted</TH></TR></THead>
                      <TBody>
                        {Object.entries<any>(d.adjusted.outcomes).flatMap(([o, v]) =>
                          v.estimators.map((x: any, i: number) => (
                            <TR key={o + x.method} className="tabular">
                              <TD className="font-medium">{i === 0 ? OUTCOME_LABEL[o] : ""}</TD>
                              <TD className="text-secondary">{x.method}</TD>
                              <TD className="text-right font-medium">{pp(x.estimate)}</TD>
                              <TD className="text-right">{pp(x.ci_low)} to {pp(x.ci_high)}</TD>
                              <TD className="text-right">{i === 0 ? "–" : signedPct(x.relative_to_unadjusted, 0)}</TD>
                            </TR>
                          )),
                        )}
                      </TBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted">Adjusted estimators were not computed for this scope.</p>
                  )}
                  {vr && Object.keys(vr).length ? (
                    <div className="mt-4 rounded-md border border-border p-3 text-[13px] leading-relaxed" data-testid="variance-reduction">
                      <div className="font-medium">Variance reduction (CUPED-style, via regression adjustment)</div>
                      <p className="mt-0.5 text-secondary">
                        {Object.entries<any>(vr).map(([o, x], i) => (
                          <span key={o}>
                            {i ? " " : ""}For {o}s, adjustment removes {pct(x.variance_reduction, 0)} of the estimator&apos;s variance: the same precision as a {num(x.effective_sample_multiplier, 2)}× larger unadjusted experiment.
                          </span>
                        ))}{" "}
                        Pre-treatment covariates make tests cheaper, not just less biased.
                      </p>
                    </div>
                  ) : null}
                  {c2 ? (
                    <p className="mt-3 text-[12px] leading-relaxed text-muted">
                      Classifier two-sample test: a cross-fitted gradient-boosting model scored {int(c2.n_scored)} users out of fold. Estimated assignment probabilities range from{" "}
                      {pct(c2.propensity_quantiles.p01, 1)} (1st percentile) to {pct(c2.propensity_quantiles.p99, 1)} (99th), so overlap is good and no user is close to deterministic assignment.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Segment comparisons</CardTitle>
                <CardDescription>
                  {seg.data?.segment_definition} Features are anonymised, so segments can be acted on but not named.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="no-print mb-4 flex flex-wrap items-end gap-3">
                  <Field label="Outcome" htmlFor="seg-outcome">
                    <Select id="seg-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-40">
                      {(meta?.outcomes ?? ["visit", "conversion"]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Feature" htmlFor="seg-feature">
                    <Select id="seg-feature" data-testid="segment-feature" value={feature} onChange={(e) => setFeature(e.target.value)} className="w-32">
                      {(meta?.features ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
                    </Select>
                  </Field>
                  <Field label="Effect estimate" htmlFor="seg-basis">
                    <Select id="seg-basis" data-testid="segment-basis" value={segBasis} onChange={(e) => setSegBasis(e.target.value)} className="w-64" disabled={!seg.data?.has_adjusted_effects}>
                      <option value="unadjusted">Unadjusted (treated − control rate)</option>
                      <option value="adjusted">Covariate-adjusted (doubly robust)</option>
                    </Select>
                  </Field>
                  {f ? (
                    <div className="flex items-center gap-2 pb-1.5 text-xs text-secondary">
                      <Badge variant={f.heterogeneity.p_value_holm < 0.05 ? "accent" : "neutral"}>
                        Heterogeneity: Cochran Q = {num(f.heterogeneity.q, 1)}, p (Holm) {pval(f.heterogeneity.p_value_holm)}
                      </Badge>
                      <span>I² = {pct(f.heterogeneity.i_squared, 0)}</span>
                    </div>
                  ) : null}
                </div>
                <DataState loading={seg.loading} error={seg.error} hasData={!!f}>
                  {f ? (
                    <>
                      <ForestPlot
                        ariaLabel={`${OUTCOME_LABEL[outcome]} effect by ${feature} segment`}
                        format={(v) => pp(v, 2)}
                        tickFormat={(v) => (v * 100).toFixed(1)}
                        rows={f.segments.map((s: any) => ({ key: String(s.segment_id), label: s.segment, sublabel: `${int(s.n_users)} users`, value: adj ? s.adjusted_effect : s.absolute_effect, low: adj ? s.adjusted_ci_low : s.ci_low, high: adj ? s.adjusted_ci_high : s.ci_high, muted: s.low_sample }))}
                      />
                      <p className="mt-1 text-[11px] text-muted" data-testid="segment-axis-note">Axis: {adj ? "covariate-adjusted" : "unadjusted"} percentage-point effect on {OUTCOME_LABEL[outcome].toLowerCase()} rate, 95% CI. Faded rows have fewer than {int(seg.data.min_control_for_reliable_segment)} control users.</p>
                      <Table className="mt-4">
                        <THead>
                          <TR><TH>Segment</TH><TH className="text-right">Value range</TH><TH className="text-right">Users</TH><TH className="text-right">Control rate</TH><TH className="text-right">Treatment rate</TH><TH className="text-right">Effect</TH><TH className="text-right">Adjusted effect</TH><TH className="text-right">Relative</TH><TH className="text-right">p</TH><TH className="text-right">p (BH)</TH><TH className="text-right">p (Holm)</TH></TR>
                        </THead>
                        <TBody>
                          {f.segments.map((s: any) => (
                            <TR key={s.segment_id} className="tabular">
                              <TD className="font-medium">{s.segment}{s.low_sample ? <Badge variant="warning" className="ml-2">low sample</Badge> : null}</TD>
                              <TD className="text-right text-secondary">{s.value_min === s.value_max ? num(s.value_min, 2) : `${num(s.value_min, 2)} – ${num(s.value_max, 2)}`}</TD>
                              <TD className="text-right">{int(s.n_users)}</TD>
                              <TD className="text-right">{pct(s.rate_control, 3)}</TD><TD className="text-right">{pct(s.rate_treatment, 3)}</TD>
                              <TD className="text-right font-medium">{pp(s.absolute_effect)}</TD><TD className="text-right font-medium">{pp(s.adjusted_effect)}</TD><TD className="text-right">{signedPct(s.relative_effect)}</TD>
                              <TD className="text-right">{pval(s.p_value)}</TD><TD className="text-right">{pval(s.p_value_bh)}</TD><TD className="text-right">{pval(s.p_value_holm)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                      <p className="mt-3 text-[12px] leading-relaxed text-muted">
                        {seg.data.n_tests} segment tests were run for this outcome. {seg.data.adjustment}. {seg.data.has_adjusted_effects ? seg.data.adjusted_definition : ""} p-values refer to the unadjusted effect. Segment effects are descriptive: they show where response concentrates, not why.
                      </p>
                    </>
                  ) : null}
                </DataState>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hypothesis tests run on this page</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>Question</TH><TH>Test</TH><TH className="text-right">Statistic</TH><TH className="text-right">p-value</TH><TH>Reading</TH></TR></THead>
                  <TBody>
                    <TR className="tabular"><TD>Is the split 85/15 as designed?</TD><TD className="text-secondary">χ² goodness of fit (1 df)</TD><TD className="text-right">{num(d.srm.chi_square, 4)}</TD><TD className="text-right">{pval(d.srm.p_value)}</TD><TD><StatusBadge ok={!d.srm.mismatch_detected} okLabel="No mismatch" failLabel="Mismatch" /></TD></TR>
                    {Object.entries<any>(d.outcomes).map(([o, x]) => (
                      <TR key={o} className="tabular"><TD>Does treatment change the {o} rate?</TD><TD className="text-secondary">{x.test}</TD><TD className="text-right">z = {num(x.z_statistic, 1)}</TD><TD className="text-right">{pval(x.p_value_holm)} (Holm)</TD><TD><Badge variant={x.significant_after_holm ? "accent" : "neutral"}>{x.significant_after_holm ? "Effect detected" : "No effect detected"}</Badge></TD></TR>
                    ))}
                    {om ? <TR className="tabular"><TD>Do features jointly predict assignment?</TD><TD className="text-secondary">Omnibus F-test, OLS of treatment on 12 features</TD><TD className="text-right">F = {num(om.f_statistic, 1)}</TD><TD className="text-right">{pval(om.p_value)}</TD><TD><Badge variant={om.p_value < 0.001 ? "warning" : "good"}>{om.p_value < 0.001 ? "Yes, weakly" : "No"}</Badge></TD></TR> : null}
                    {c2 ? <TR className="tabular"><TD>Can a flexible model tell the arms apart?</TD><TD className="text-secondary">Classifier two-sample test (out-of-fold AUC)</TD><TD className="text-right">AUC = {num(c2.auc, 3)}</TD><TD className="text-right">{pval(c2.p_value)}</TD><TD><Badge variant={c2.p_value < 0.001 ? "warning" : "good"}>{c2.p_value < 0.001 ? "Yes, weakly" : "No"}</Badge></TD></TR> : null}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DataState>
    </>
  );
}
