"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { CalibrationChart } from "@/components/charts/calibration-chart";
import { CurveChart } from "@/components/charts/curve-chart";
import { ExplainPanel } from "@/components/explain-panel";
import { Callout, DataState, NextStep, PageHeader } from "@/components/page";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATIC_MODE, api, useApi, withScope } from "@/lib/api";
import { MODEL_COLOR, OUTCOME_LABEL, int, num, pct, pp } from "@/lib/format";
import { Term } from "@/components/term";
import { CsvButton } from "@/components/csv-button";

const k = (v: number | undefined | null, d = 2) => (v == null ? "–" : (v * 1000).toFixed(d));
const ci = (m: any, d = 2) => (m?.low == null ? "" : `${k(m.low, d)} to ${k(m.high, d)}`);

function TrainingPanel({ run, rows, onDone }: { run: any; rows: any; onDone: () => void }) {
  const { setScope, meta } = useApp();
  const [status, setStatus] = React.useState<any>(null);
  const [seed, setSeed] = React.useState<number>(meta?.seed ?? 20240612);
  const [err, setErr] = React.useState<string | null>(null);

  const poll = React.useCallback(async () => {
    try {
      const s = await api("/train/status");
      setStatus(s);
      return s;
    } catch (e: any) {
      setErr(e.message);
      return null;
    }
  }, []);

  React.useEffect(() => {
    poll();
  }, [poll]);

  React.useEffect(() => {
    if (status?.state !== "running") return;
    const t = setInterval(async () => {
      const s = await poll();
      if (s && s.state !== "running") {
        clearInterval(t);
        if (s.state === "completed") {
          setScope("dev_sample");
          onDone();
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [status?.state, poll, onDone, setScope]);

  const start = async () => {
    setErr(null);
    try {
      setStatus(await api("/train", { method: "POST", body: JSON.stringify({ seed, n_boot: 100 }) }));
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const running = status?.state === "running";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training status</CardTitle>
        <CardDescription>The run that produced the models on this page, and an on-demand retrain on the development sample.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <div>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-xs tabular">
            <dt className="text-muted">Status</dt><dd><Badge variant="good" data-testid="run-status">{run.status}</Badge></dd>
            <dt className="text-muted">Finished</dt><dd>{new Date(run.finished_at).toLocaleString()}</dd>
            <dt className="text-muted">Wall time</dt><dd>{num(run.seconds, 0)} s</dd>
            <dt className="text-muted">Seed</dt><dd>{run.seed}</dd>
            <dt className="text-muted">Train rows</dt><dd>{int(rows.train)} ({int(rows.train_treatment)} treatment · {int(rows.train_control)} control)</dd>
            <dt className="text-muted">Validation / test rows</dt><dd>{int(rows.valid)} / {int(rows.test)}</dd>
            <dt className="text-muted">Positives (train / test)</dt><dd>{int(rows.train_positives)} / {int(rows.test_positives)}</dd>
            <dt className="text-muted">Bootstrap replicates</dt><dd>{run.n_boot} (paired, Poisson)</dd>
            <dt className="text-muted">Libraries</dt><dd>scikit-learn {run.tooling.scikit_learn} · Python {run.tooling.python}</dd>
          </dl>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-secondary">Leakage controls</div>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-secondary">
              {run.leakage_controls.map((c: string) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <div className="no-print rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Seed" htmlFor="train-seed">
                <Input id="train-seed" type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-36" disabled={running} />
              </Field>
              <Button onClick={start} disabled={running || status?.can_train === false} data-testid="train-button">
                <Play className="h-3.5 w-3.5" aria-hidden />
                {running ? "Training…" : "Retrain on development sample"}
              </Button>
            </div>
            {running ? (
              <div className="mt-3" data-testid="train-progress">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
                  <div className="h-full bg-accent transition-all" style={{ width: `${(100 * (status.step ?? 0)) / (status.total ?? 10)}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-secondary tabular">Step {status.step}/{status.total}: {status.message}</p>
              </div>
            ) : status?.state === "completed" ? (
              <p className="mt-2 text-[11px] text-secondary">Last on-demand run finished in {status.elapsed_seconds}s (seed {status.seed}). Showing the development sample.</p>
            ) : status?.state === "failed" ? (
              <p role="alert" className="mt-2 text-[11px] text-critical">Training failed: {status.error}</p>
            ) : (
              <p className="mt-2 text-[11px] leading-snug text-muted">
                {STATIC_MODE
                  ? "This hosted demo serves cached results; retraining runs with the Python backend (clone the repo and run make api)."
                  : status?.can_train === false
                  ? "Row-level data is not on this server, so training is disabled. Cached results are still served."
                  : "Runs in the background (about 20 seconds) and replaces the development-sample results only. Full-dataset training is a CLI job."}
              </p>
            )}
            {err ? <p role="alert" className="mt-2 text-[11px] text-critical">{err}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ModelsPage() {
  const { scope, meta } = useApp();
  const [outcome, setOutcome] = React.useState("visit");
  const [basis, setBasis] = React.useState("adjusted");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const models = useApi<any>(scope ? withScope(`/models?outcome=${outcome}`, scope) : null, [nonce]);
  const curves = useApi<any>(scope ? withScope(`/curves?outcome=${outcome}`, scope) : null, [nonce]);
  const explain = useApi<any>(scope ? withScope(`/explain?outcome=${outcome}`, scope) : null, [nonce]);
  const m = models.data;
  const c = curves.data;
  const highlight = selected && m?.models.some((x: any) => x.id === selected) ? selected : m?.champion;
  const card = m?.models.find((x: any) => x.id === highlight);
  const champ = m?.models.find((x: any) => x.is_champion);
  const names: Record<string, string> = Object.fromEntries((m?.models ?? []).map((x: any) => [x.id, x.name]));
  const gor = `gain_over_random_${basis}`;
  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  const series = (key: string) =>
    c ? Object.entries<any>(c.models).map(([id, v]) => ({ id, name: names[id] ?? id, values: v[key].value.map((y: number) => y * 1000), low: v[key].low?.map((y: number) => y * 1000), high: v[key].high?.map((y: number) => y * 1000) })) : [];
  const x = c ? c.fraction.map((f: number) => Math.round(f * 1000) / 10) : [];

  return (
    <>
      <PageHeader
        title="Uplift model lab"
        description="Who responds to treatment? Five targeting strategies trained on 60% of users and compared on a 20% test split none of them saw."
        meta={m?.meta}
        summary={
          m && champ
            ? [
                <>Four targeting models were trained on 60% of users and scored on 20% they had never seen, against random targeting.</>,
                <>The best (<strong>{champ.name}</strong>) finds a top 10% whose <Term k="uplift">uplift</Term> is {(champ.test_metrics[`uplift_at_10_${basis}`].value / champ.test_metrics[`total_effect_${basis}`].value).toFixed(0)}× the average user&apos;s.</>,
                <>A simple <Term k="response">response model</Term> does nearly as well: choosing to target matters more than which model you use.</>,
              ]
            : null
        }
      >
        <Field label="Outcome" htmlFor="m-outcome">
          <Select id="m-outcome" data-testid="model-outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value); setSelected(null); }} className="w-40">
            {(meta?.outcomes ?? ["visit", "conversion"]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </Select>
        </Field>
        <Field label="Evaluation basis" htmlFor="m-basis">
          <Select id="m-basis" value={basis} onChange={(e) => setBasis(e.target.value)} className="w-64">
            <option value="adjusted">Covariate-adjusted (doubly robust)</option>
            <option value="unadjusted">Unadjusted (treated − control rate)</option>
          </Select>
        </Field>
        <Field label="Highlighted model" htmlFor="m-model">
          <Select id="m-model" data-testid="model-select" value={highlight ?? ""} onChange={(e) => setSelected(e.target.value)} className="w-60">
            {(m?.models ?? []).filter((x: any) => x.id !== "random").map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.is_champion ? " (champion)" : ""}</option>)}
          </Select>
        </Field>
      </PageHeader>

      <DataState loading={models.loading || curves.loading} error={models.error ?? curves.error} hasData={!!m && !!c}>
        {m && c && card && champ ? (
          <div className="flex flex-col gap-4">
            <Callout tone="info" title={`Champion for ${OUTCOME_LABEL[outcome].toLowerCase()}: ${champ.name}`} testId="champion-callout">
              {m.selection.rule} On the test split its top 10% of users show an effect of {pp(champ.test_metrics[`uplift_at_10_${basis}`].value, 2)} per user against a population average of{" "}
              {pp(champ.test_metrics[`total_effect_${basis}`].value, 2)}.
            </Callout>

            <Card>
              <CardHeader>
                <CardTitle>Performance comparison (test split, {int(m.rows.test)} users)</CardTitle>
                <CardDescription>
                  Gain over random is the area between a strategy’s cumulative uplift curve and random targeting, in incremental {outcome}s per 1,000 users averaged over all targeting depths. Intervals are 95% bootstrap.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table data-testid="model-table">
                  <THead>
                    <TR>
                      <TH>Strategy</TH><TH className="text-right">Gain over random</TH><TH className="text-right">95% CI</TH><TH className="text-right">Δ vs response model</TH>
                      <TH className="text-right">P(beats response)</TH><TH className="text-right">Effect in top 10%</TH><TH className="text-right">Qini coefficient</TH><TH className="text-right">Validation gain</TH><TH className="text-right">Fit (s)</TH><TH>Version</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {m.models.map((x: any) => {
                      const g = x.test_metrics[gor];
                      const vs = g.vs_reference;
                      return (
                        <TR key={x.id} className="tabular" data-model={x.id}>
                          <TD>
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: MODEL_COLOR[x.id] }} />
                              <span className="font-medium">{x.name}</span>
                              {x.is_champion ? <Badge variant="accent">champion</Badge> : null}
                              {!x.estimates_uplift ? <Badge>baseline</Badge> : null}
                            </span>
                          </TD>
                          <TD className="text-right font-medium">{k(g.value)}</TD>
                          <TD className="text-right text-secondary">{x.id === "random" ? "–" : ci(g)}</TD>
                          <TD className="text-right">{vs && x.id !== "random" ? `${vs.difference >= 0 ? "+" : "−"}${Math.abs(vs.difference * 1000).toFixed(2)} (${k(vs.low)} to ${k(vs.high)})` : "–"}</TD>
                          <TD className="text-right">{vs && x.id !== "random" ? pct(vs.prob_better, 0) : "–"}</TD>
                          <TD className="text-right">{pp(x.test_metrics[`uplift_at_10_${basis}`].value, 2)}</TD>
                          <TD className="text-right">{k(x.test_metrics.qini_coefficient.value)}</TD>
                          <TD className="text-right text-secondary">{k(x.validation_metrics[gor])}</TD>
                          <TD className="text-right text-secondary">{x.id === "response" ? "shared" : x.fit_seconds ?? "–"}</TD>
                          <TD className="font-mono text-[11px] text-muted">{x.version}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                <div className="mt-3 flex justify-end">
                  <CsvButton
                    filename={`model-comparison-${outcome}-${basis}.csv`}
                    columns={["model", "is_champion", `gain_over_random_${basis}`, "ci_low", "ci_high", "diff_vs_response", "prob_beats_response", `uplift_at_10_${basis}`, "qini_coefficient", "validation_gain", "version"]}
                    rows={m.models.map((x: any) => {
                      const g = x.test_metrics[gor];
                      return [x.name, x.is_champion, g.value, g.low, g.high, g.vs_reference?.difference ?? "", g.vs_reference?.prob_better ?? "", x.test_metrics[`uplift_at_10_${basis}`].value, x.test_metrics.qini_coefficient.value, x.validation_metrics[gor], x.version];
                    })}
                  />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  The response model reuses the T-learner’s treated-arm model, so it has no separate fit time. Qini coefficient uses the classic unadjusted construction regardless of the basis selected above.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Uplift and Qini curves</CardTitle>
                <CardDescription>
                  Rank test users by each strategy’s score and treat from the top. A better strategy accumulates incremental {outcome}s faster; every strategy ends at the same point, where everyone is treated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="uplift">
                  <TabsList>
                    <TabsTrigger value="uplift">Cumulative uplift</TabsTrigger>
                    <TabsTrigger value="qini">Qini</TabsTrigger>
                  </TabsList>
                  <TabsContent value="uplift" className="pt-4" data-testid="uplift-chart">
                    <CurveChart ariaLabel="Cumulative uplift curves by strategy" x={x} series={series(basis)} highlight={highlight} yLabel={`Incremental ${outcome}s per 1,000 users`} yFormat={(v) => v.toFixed(outcome === "visit" ? 0 : 1)} tooltipFormat={(v) => v.toFixed(2)} />
                  </TabsContent>
                  <TabsContent value="qini" className="pt-4">
                    <CurveChart ariaLabel="Qini curves by strategy" x={x} series={series("qini")} highlight={highlight} yLabel={`Incremental ${outcome}s per 1,000 treated`} yFormat={(v) => v.toFixed(outcome === "visit" ? 0 : 1)} tooltipFormat={(v) => v.toFixed(2)} />
                    <p className="mt-2 text-[12px] text-muted">Qini (Radcliffe): treated responders minus control responders rescaled to the treated group size, always on the unadjusted basis.</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Calibration of predicted uplift: {card.name}</CardTitle>
                  <CardDescription>
                    {card.estimates_uplift
                      ? "If the model is calibrated, the dot (what it predicted) sits at the top of the bar (what happened) in every decile."
                      : "This baseline ranks users by expected outcome and does not predict uplift, so there is nothing to calibrate. Its outcome-model diagnostics are on the right."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {card.calibration ? (
                    <>
                      <CalibrationChart rows={card.calibration} basis={basis} color={MODEL_COLOR[card.id]} />
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-secondary">Decile table</summary>
                        <Table className="mt-2">
                          <THead><TR><TH>Decile</TH><TH className="text-right">Users</TH><TH className="text-right">Treated share</TH><TH className="text-right">Predicted</TH><TH className="text-right">Observed (unadj.)</TH><TH className="text-right">Observed (adj.)</TH></TR></THead>
                          <TBody>
                            {card.calibration.map((r: any) => (
                              <TR key={r.group} className="tabular"><TD>{r.group}</TD><TD className="text-right">{int(r.n_users)}</TD><TD className="text-right">{pct(r.treatment_share, 1)}</TD><TD className="text-right">{pp(r.mean_predicted_uplift)}</TD><TD className="text-right">{pp(r.observed_uplift)} ± {(1.96 * r.observed_std_error * 100).toFixed(3)}</TD><TD className="text-right">{pp(r.observed_uplift_adjusted)} ± {(1.96 * r.observed_adjusted_std_error * 100).toFixed(3)}</TD></TR>
                            ))}
                          </TBody>
                        </Table>
                      </details>
                      <p className="mt-2 text-[12px] text-muted">
                        {pct(card.predicted_uplift_summary.share_negative, 1)} of test users have a negative predicted uplift; the median prediction is {pp(card.predicted_uplift_summary.p50)}.
                      </p>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Underlying outcome models: {card.name}</CardTitle>
                  <CardDescription>
                    Discrimination and calibration of the probability models inside this strategy, each scored on the test users of the arm it describes. Good outcome prediction does not by itself imply good uplift ranking.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead><TR><TH>Predicts outcome under</TH><TH className="text-right">Test users</TH><TH className="text-right">Positives</TH><TH className="text-right">AUC</TH><TH className="text-right">Log loss</TH><TH className="text-right">Brier</TH></TR></THead>
                    <TBody>
                      {Object.entries<any>(card.outcome_models ?? {}).map(([arm, dgn]) => (
                        <TR key={arm} className="tabular"><TD className="font-medium capitalize">{arm}</TD><TD className="text-right">{int(dgn.n)}</TD><TD className="text-right">{int(dgn.positives)}</TD><TD className="text-right">{num(dgn.auc, 3)}</TD><TD className="text-right">{num(dgn.log_loss, 4)}</TD><TD className="text-right">{num(dgn.brier, 5)}</TD></TR>
                      ))}
                    </TBody>
                  </Table>
                  <p className="mt-4 text-xs leading-relaxed text-secondary"><span className="font-medium text-foreground">{card.family}.</span> {card.description}</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-secondary">Hyper-parameters</summary>
                    <pre className="mt-2 overflow-x-auto rounded-md border border-border p-3 font-mono text-[11px] text-secondary">{JSON.stringify(card.params, null, 2)}</pre>
                  </details>
                </CardContent>
              </Card>
            </div>

            {explain.data ? <ExplainPanel ex={explain.data} outcome={outcome} /> : null}

            <TrainingPanel run={m.run} rows={m.rows} onDone={refresh} />
          </div>
        ) : null}
      </DataState>
      <NextStep />
    </>
  );
}
