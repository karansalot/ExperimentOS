"use client";

import * as React from "react";
import { DataState, NextStep, PageHeader, StatusBadge } from "@/components/page";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useApi, withScope } from "@/lib/api";
import { int, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CsvButton } from "@/components/csv-button";

const cell = (v: any) => (v == null ? "–" : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : String(v)) : String(v));

export default function SqlPage() {
  const { scope } = useApp();
  const [id, setId] = React.useState("05_ate_two_proportion");
  const catalog = useApi<any>(scope ? withScope("/sql", scope) : null);
  const query = useApi<any>(scope ? withScope(`/sql/${id}`, scope) : null);
  const dq = useApi<any>(scope ? withScope("/data-quality", scope) : null);
  const q = query.data;

  return (
    <>
      <PageHeader
        title="SQL & data quality"
        description="The analytical layer behind the dashboards: DuckDB views and queries over Parquet, plus the validation rules every pipeline run must pass."
        meta={catalog.data?.meta}
        summary={
          dq.data
            ? [
                <>{dq.data.checks.filter((c: any) => c.passed).length} of {dq.data.checks.length} data checks pass on {int(dq.data.profile.n_users)} rows.</>,
                <>The raw file is stored in single-arm blocks, so every sample and split here uses a hash of row position, never &quot;the first N rows&quot;.</>,
                <>Each query below states the question it answers. Pick one to see its SQL and its result.</>,
              ]
            : null
        }
      />
      <div className="flex flex-col gap-4">
        <DataState loading={dq.loading} error={dq.error} hasData={!!dq.data}>
          {dq.data ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Validation rules</CardTitle>
                  <CardDescription>
                    {dq.data.checks.filter((c: any) => c.passed).length} of {dq.data.checks.length} checks pass on {int(dq.data.profile.n_users)} rows.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table data-testid="dq-checks">
                    <THead><TR><TH>Check</TH><TH>Severity</TH><TH className="text-right">Violating rows</TH><TH>Result</TH></TR></THead>
                    <TBody>
                      {dq.data.checks.map((c: any) => (
                        <TR key={c.check_name}><TD className="font-mono text-[11px]">{c.check_name}</TD><TD className="text-secondary">{c.severity}</TD><TD className="text-right tabular">{int(c.violating_rows)}</TD><TD><StatusBadge ok={c.passed} /></TD></TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Findings that shape the analysis</CardTitle>
                  <CardDescription>What profiling the raw file revealed, and what the pipeline does about it.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {dq.data.findings.map((f: any) => (
                    <div key={f.title} className="text-[13px] leading-relaxed">
                      <div className="flex items-center gap-2 font-medium">
                        <Badge variant={f.severity === "warn" ? "warning" : "neutral"}>{f.severity === "warn" ? "caution" : "note"}</Badge>
                        {f.title}
                      </div>
                      <p className="mt-0.5 text-secondary">{f.detail}</p>
                    </div>
                  ))}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-secondary">Feature concentration</summary>
                    <Table className="mt-2">
                      <THead><TR><TH>Feature</TH><TH className="text-right">Distinct values</TH><TH className="text-right">Share at modal value</TH><TH className="text-right">Min</TH><TH className="text-right">Max</TH></TR></THead>
                      <TBody>
                        {dq.data.feature_profile.map((f: any) => (
                          <TR key={f.feature} className="tabular"><TD className="font-mono">{f.feature}</TD><TD className="text-right">{int(f.distinct_values)}</TD><TD className="text-right">{pct(f.share_at_modal_value, 1)}</TD><TD className="text-right">{f.min_value}</TD><TD className="text-right">{f.max_value}</TD></TR>
                        ))}
                      </TBody>
                    </Table>
                  </details>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DataState>

        <DataState loading={catalog.loading} error={catalog.error} hasData={!!catalog.data}>
          {catalog.data ? (
            <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
              <Card className="self-start">
                <CardHeader>
                  <CardTitle>{catalog.data.queries.length} analytical queries</CardTitle>
                  <CardDescription>Executed by {catalog.data.engine} on every pipeline run; results are cached.</CardDescription>
                </CardHeader>
                <CardContent className="px-2">
                  <ul className="flex flex-col" data-testid="query-list">
                    {catalog.data.queries.map((x: any) => (
                      <li key={x.id}>
                        <button
                          onClick={() => setId(x.id)}
                          aria-current={x.id === id}
                          className={cn("w-full rounded-md px-3 py-2 text-left transition-colors", x.id === id ? "bg-accent-soft" : "hover:bg-wash ")}
                        >
                          <div className="flex items-center justify-between gap-2 text-[13px] font-medium">
                            <span><span className="mr-1.5 text-muted tabular">{x.id.slice(0, 2)}</span>{x.title}</span>
                            {x.status !== "ok" ? <Badge variant="warning">{x.status}</Badge> : null}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-snug text-muted">{x.technique}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <DataState loading={query.loading} error={query.error} hasData={!!q}>
                {q ? (
                  <Card data-testid="query-detail">
                    <CardHeader>
                      <CardTitle>{q.title}</CardTitle>
                      <CardDescription>{q.question}</CardDescription>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Badge variant="accent">{q.technique}</Badge>
                        {q.status === "ok" ? <Badge>{q.row_count} rows · {q.seconds}s</Badge> : <Badge variant="warning">{q.reason}</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <pre className="max-h-[420px] overflow-auto rounded-md border border-border p-3 font-mono text-[11.5px] leading-relaxed text-secondary" data-testid="query-sql">{q.sql}</pre>
                      {q.status === "ok" ? (
                        <div className="flex justify-end"><CsvButton filename={`${q.id}.csv`} columns={q.columns} rows={q.rows} /></div>
                      ) : null}
                      {q.status === "ok" ? (
                        <Table>
                          <THead><TR>{q.columns.map((c: string) => <TH key={c} className="font-mono text-[11px]">{c}</TH>)}</TR></THead>
                          <TBody>
                            {q.rows.map((row: any[], i: number) => (
                              <TR key={i} className="tabular">{row.map((v, j) => <TD key={j} className={typeof v === "number" ? "text-right" : ""}>{cell(v)}</TD>)}</TR>
                            ))}
                          </TBody>
                        </Table>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}
              </DataState>
            </div>
          ) : null}
        </DataState>
      </div>
      <NextStep />
    </>
  );
}
