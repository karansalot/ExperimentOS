"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy, Download, Printer } from "lucide-react";
import { DataState, PageHeader } from "@/components/page";
import { useScenarioResult } from "@/components/scenario-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TR } from "@/components/ui/table";

export default function BriefPage() {
  const { data: b, error, loading } = useScenarioResult<any>("/brief");
  const [copied, setCopied] = React.useState(false);

  const download = () => {
    const url = URL.createObjectURL(new Blob([b.markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `experimentos-decision-brief-${b.meta.scope}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(b.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <PageHeader
        title="Decision brief"
        description="A one-page read-out for stakeholders, generated from the cached statistics and the scenario currently set in the targeting simulator."
        meta={b?.meta}
      >
        <Button onClick={download} disabled={!b} data-testid="download-brief"><Download className="h-4 w-4" aria-hidden /> Download Markdown</Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!b}><Printer className="h-4 w-4" aria-hidden /> Print or save as PDF</Button>
        <Button variant="outline" onClick={copy} disabled={!b}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy Markdown"}</Button>
        <Button asChild variant="ghost"><Link href="/simulator">Change assumptions</Link></Button>
      </PageHeader>
      <DataState loading={loading} error={error} hasData={!!b}>
        {b ? (
          <article className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="brief">
            <Card>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={b.action === "hold" ? "warning" : "accent"}>Decision</Badge>
                  <Badge>scenario-dependent</Badge>
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight" data-testid="brief-decision">{b.decision}</h2>
                <p className="mt-2 text-sm leading-relaxed text-secondary">{b.headline}</p>
                <p className="mt-3 text-xs text-muted">{b.scope_note} Generated {new Date(b.generated_at).toLocaleString()}.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Scenario assumptions (supplied by you, not from the dataset)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TBody>
                    {b.assumptions.map(([k, v]: [string, string]) => (
                      <TR key={k}><TD className="w-1/2 text-secondary">{k}</TD><TD className="font-medium tabular">{v}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            {b.sections.map((s: any) => (
              <Card key={s.id} data-testid={`brief-${s.id}`}>
                <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-secondary marker:text-muted">
                    {s.bullets.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </article>
        ) : null}
      </DataState>
    </>
  );
}
