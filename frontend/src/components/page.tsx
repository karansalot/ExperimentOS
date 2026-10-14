"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, MessageSquareText, XCircle } from "lucide-react";
import { NAV } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Meta } from "@/lib/api";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, meta, children, summary }: { title: string; description: React.ReactNode; meta?: Meta | null; children?: React.ReactNode; summary?: React.ReactNode[] | null }) {
  React.useEffect(() => {
    document.title = `${title} · ExperimentOS`;
  }, [title]);
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-secondary">{description}</p>
        </div>
        {meta ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="scope-badges">
            <Badge variant={meta.is_sample ? "warning" : "accent"} data-testid="scope-badge">
              {meta.is_sample ? "Development sample" : "Full dataset"} · {int(meta.n_rows)} users
            </Badge>
            <Badge title={`raw sha256 ${meta.raw_sha256}`}>{meta.dataset}</Badge>
            <Badge>seed {meta.seed}</Badge>
          </div>
        ) : null}
      </div>
      {summary && summary.length ? <PlainEnglish points={summary} /> : null}
      {children ? <div className="no-print flex flex-wrap items-end gap-3">{children}</div> : null}
    </header>
  );
}

export function StatTile({ label, value, sub, testId }: { label: string; value: string; sub?: React.ReactNode; testId?: string }) {
  return (
    <Card className="px-5 py-4" data-testid={testId}>
      <div className="text-xs text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs leading-snug text-muted tabular">{sub}</div> : null}
    </Card>
  );
}

const TONE = {
  info: { icon: Info, cls: "border-border bg-surface" },
  good: { icon: CheckCircle2, cls: "tone-good" },
  warning: { icon: AlertTriangle, cls: "tone-warning" },
  critical: { icon: XCircle, cls: "tone-critical" },
} as const;

export function Callout({ tone = "info", title, children, testId }: { tone?: keyof typeof TONE; title: string; children?: React.ReactNode; testId?: string }) {
  const { icon: Icon, cls } = TONE[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm", cls)} data-testid={testId}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {children ? <div className="mt-0.5 text-[13px] leading-relaxed text-secondary">{children}</div> : null}
      </div>
    </div>
  );
}

export function StatusBadge({ ok, okLabel = "Pass", failLabel = "Fail" }: { ok: boolean; okLabel?: string; failLabel?: string }) {
  return (
    <Badge variant={ok ? "good" : "critical"}>
      {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
      {ok ? okLabel : failLabel}
    </Badge>
  );
}

/** "In plain English": a short, jargon-free summary at the top of each analysis page. */
export function PlainEnglish({ points }: { points: React.ReactNode[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-3" aria-label="In plain English" data-testid="plain-english">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden /> In plain English
      </div>
      <ul className="flex flex-col gap-1 text-sm leading-relaxed">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden /><span className="min-w-0">{p}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Guides the reader to the next page in the story. */
export function NextStep() {
  const pathname = usePathname();
  const i = NAV.findIndex((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));
  const next = i >= 0 ? NAV[i + 1] : undefined;
  if (!next) return null;
  return (
    <Link href={next.href} className="no-print mt-8 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-5 py-4 transition-colors hover:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" data-testid="next-step">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Next</div>
        <div className="text-sm font-semibold">{next.label}</div>
        <div className="text-xs text-secondary">{next.hint}</div>
      </div>
      <ArrowRight className="h-5 w-5 text-accent" aria-hidden />
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[92px]" />)}
      </div>
      <div className="skeleton h-[300px]" />
      <div className="skeleton h-[180px]" />
    </div>
  );
}

export function DataState({ loading, error, hasData, children }: { loading: boolean; error: string | null; hasData: boolean; children: React.ReactNode }) {
  if (error && !hasData)
    return (
      <div role="alert" className="rounded-lg border tone-critical px-4 py-3 text-sm">
        <strong className="font-semibold">Could not load this view.</strong> {error}
      </div>
    );
  if (!hasData) return <Skeleton />;
  return (
    <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      {error ? (
        <div role="alert" className="mb-3 rounded-lg border tone-critical px-4 py-2 text-sm">{error}</div>
      ) : null}
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; shape?: "line" | "rect" | "dot" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.shape === "rect" ? (
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: it.color }} />
          ) : it.shape === "dot" ? (
            <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          ) : (
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
