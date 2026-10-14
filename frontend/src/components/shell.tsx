"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, AlertTriangle, Calculator, Database, FileText, FlaskConical, Lightbulb, LineChart, SlidersHorizontal, Stethoscope, Timer } from "lucide-react";
import { useApp } from "@/components/providers";
import { Select } from "@/components/ui/form";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Insights", icon: Lightbulb },
  { href: "/overview", label: "Experiment overview", icon: Activity },
  { href: "/diagnostics", label: "Statistical diagnostics", icon: Stethoscope },
  { href: "/models", label: "Uplift model lab", icon: LineChart },
  { href: "/simulator", label: "Targeting simulator", icon: SlidersHorizontal },
  { href: "/brief", label: "Decision brief", icon: FileText },
  { href: "/planner", label: "Experiment planner", icon: Calculator },
  { href: "/sequential", label: "Sequential testing lab", icon: Timer },
  { href: "/sql", label: "SQL & data quality", icon: Database },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { meta, metaError, scope, setScope } = useApp();
  const current = meta?.scopes.find((s) => s.name === scope);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="no-print flex shrink-0 flex-col gap-6 border-b border-border bg-surface px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-1">
          <FlaskConical className="h-5 w-5 text-accent" aria-hidden />
          <div>
            <div className="text-sm font-semibold leading-tight">ExperimentOS</div>
            <div className="text-[11px] leading-tight text-muted">Experimentation & uplift analytics</div>
          </div>
        </div>
        <nav aria-label="Primary" className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-[13px] transition-colors",
                  active ? "bg-accent-soft font-medium text-foreground" : "text-secondary hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col gap-2 lg:mt-auto">
          <label htmlFor="scope" className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Data scope
          </label>
          <Select id="scope" data-testid="scope-select" value={scope ?? ""} onChange={(e) => setScope(e.target.value)} disabled={!meta}>
            {meta?.scopes.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </Select>
          {current ? <p className="text-[11px] leading-snug text-muted tabular">{int(current.meta.n_rows)} users analysed</p> : null}
          <p className="text-[11px] leading-snug text-muted">
            Criteo Uplift v2.1 · CC BY-NC-SA 4.0
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {metaError ? (
          <div role="alert" className="mb-4 rounded-lg border tone-critical px-4 py-3 text-sm">
            <strong className="font-semibold">Cannot reach the ExperimentOS API.</strong> {metaError} Start it with{" "}
            <code className="font-mono text-xs">make api</code> and reload.
          </div>
        ) : null}
        {current?.is_sample ? (
          <div
            role="status"
            data-testid="sample-banner"
            className="mb-4 flex items-start gap-2 rounded-lg border tone-warning px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Development sample.</strong> Every number on this page is computed on{" "}
              {int(current.meta.n_rows)} users (~{Math.round((current.meta.n_rows / current.meta.full_dataset_rows) * 100)}% of the{" "}
              {int(current.meta.full_dataset_rows)}-row dataset). These are not full-dataset results.
            </span>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
