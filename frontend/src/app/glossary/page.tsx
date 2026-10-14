"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { NextStep, PageHeader } from "@/components/page";
import { Input } from "@/components/ui/form";
import { GLOSSARY } from "@/lib/glossary";

export default function GlossaryPage() {
  const [q, setQ] = React.useState("");
  const entries = Object.entries(GLOSSARY)
    .filter(([, g]) => (g.term + " " + g.short).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a[1].term.localeCompare(b[1].term));
  return (
    <>
      <PageHeader title="Glossary" description="Every technical term used in ExperimentOS, explained without jargon. Dotted-underlined words elsewhere in the app link here." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Search the glossary" placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" data-testid="glossary-search" />
      </div>
      <dl className="grid gap-3 md:grid-cols-2" data-testid="glossary-list">
        {entries.map(([k, g]) => (
          <div key={k} id={k} className="scroll-mt-20 rounded-lg border border-border bg-surface px-4 py-3 target:ring-2 target:ring-accent">
            <dt className="text-sm font-semibold">{g.term}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-secondary">{g.short}</dd>
          </div>
        ))}
        {entries.length === 0 ? <p className="text-sm text-muted">No terms match “{q}”.</p> : null}
      </dl>
      <NextStep />
    </>
  );
}
