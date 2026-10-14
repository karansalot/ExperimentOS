"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity, AlertTriangle, BookOpen, Calculator, Database, FileText, FlaskConical, Github, Lightbulb, LineChart, Menu, Monitor, Moon,
  SlidersHorizontal, Stethoscope, Sun, Timer, X,
} from "lucide-react";
import { useApp, type Theme } from "@/components/providers";
import { Select } from "@/components/ui/form";
import { STATIC_MODE } from "@/lib/api";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";

export const NAV_GROUPS = [
  {
    label: "Understand",
    items: [
      { href: "/", label: "Insights", hint: "The ten findings, in plain words", icon: Lightbulb },
      { href: "/overview", label: "Experiment overview", hint: "Did it work, and by how much?", icon: Activity },
      { href: "/diagnostics", label: "Statistical diagnostics", hint: "Can we trust the comparison?", icon: Stethoscope },
    ],
  },
  {
    label: "Decide",
    items: [
      { href: "/models", label: "Uplift model lab", hint: "Who responds to treatment?", icon: LineChart },
      { href: "/simulator", label: "Targeting simulator", hint: "Who should we treat, and is it worth it?", icon: SlidersHorizontal },
      { href: "/brief", label: "Decision brief", hint: "A one-page read-out to share", icon: FileText },
    ],
  },
  {
    label: "Plan next",
    items: [
      { href: "/planner", label: "Experiment planner", hint: "How big should the next test be?", icon: Calculator },
      { href: "/sequential", label: "Sequential testing lab", hint: "Can we stop a test early?", icon: Timer },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/sql", label: "SQL & data quality", hint: "The queries and checks behind it all", icon: Database },
      { href: "/glossary", label: "Glossary", hint: "Every term, in plain English", icon: BookOpen },
    ],
  },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "System", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
];

function ThemeSwitch() {
  const { theme, setTheme } = useApp();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-md border border-border p-0.5" data-testid="theme-switch">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={theme === id}
          aria-label={`${label} theme`}
          title={`${label} theme`}
          onClick={() => setTheme(id)}
          className={cn("rounded-[5px] p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            theme === id ? "bg-accent-soft text-foreground" : "text-muted hover:bg-wash hover:text-foreground")}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{g.label}</div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ href, label, hint, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active(href) ? "page" : undefined}
                  title={hint}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    active(href) ? "bg-accent-soft font-medium text-foreground" : "text-secondary hover:bg-wash hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { meta, scope, setScope } = useApp();
  const current = meta?.scopes.find((s) => s.name === scope);
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="scope" className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Data scope</label>
      <Select id="scope" data-testid="scope-select" value={scope ?? ""} onChange={(e) => setScope(e.target.value)} disabled={!meta}>
        {meta?.scopes.map((s) => (
          <option key={s.name} value={s.name}>{s.label}</option>
        ))}
      </Select>
      {current ? <p className="text-[11px] leading-snug text-muted tabular">{int(current.meta.n_rows)} users analysed</p> : null}
      <div className="flex items-center justify-between gap-2 pt-1">
        <ThemeSwitch />
        <a href="https://github.com/karansalot/ExperimentOS" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-secondary hover:text-foreground" aria-label="Source code on GitHub">
          <Github className="h-3.5 w-3.5" aria-hidden /> Source
        </a>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Criteo Uplift v2.1 · CC BY-NC-SA 4.0{STATIC_MODE ? " · static demo: cached results, calculators run in your browser" : ""}
      </p>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <FlaskConical className="h-5 w-5 text-accent" aria-hidden />
      <div>
        <div className="text-sm font-semibold leading-tight">ExperimentOS</div>
        <div className="text-[11px] leading-tight text-muted">Experimentation & uplift analytics</div>
      </div>
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { meta, metaError, scope } = useApp();
  const [open, setOpen] = React.useState(false);
  const current = meta?.scopes.find((s) => s.name === scope);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      {/* Mobile top bar with a slide-in menu */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button className="rounded-md p-2 text-secondary hover:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Open menu" data-testid="menu-button">
              <Menu className="h-5 w-5" aria-hidden />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-xs flex-col gap-5 overflow-y-auto bg-surface px-4 py-4 shadow-xl" aria-describedby={undefined}>
              <div className="flex items-center justify-between">
                <Dialog.Title asChild><div><Brand /></div></Dialog.Title>
                <Dialog.Close className="rounded-md p-2 text-secondary hover:bg-wash" aria-label="Close menu"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
              </div>
              <NavList onNavigate={() => setOpen(false)} />
              <div className="mt-auto"><SidebarFooter /></div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      {/* Desktop sidebar */}
      <aside className="no-print hidden shrink-0 flex-col gap-6 border-r border-border bg-surface px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:overflow-y-auto">
        <Brand />
        <NavList />
        <div className="mt-auto"><SidebarFooter /></div>
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-[1400px]">
          {metaError ? (
            <div role="alert" className="tone-critical mb-4 rounded-lg border px-4 py-3 text-sm">
              <strong className="font-semibold">Cannot load the analysis data.</strong> {metaError}{" "}
              {STATIC_MODE ? "Try reloading the page." : <>Start the API with <code className="font-mono text-xs">make api</code> and reload.</>}
            </div>
          ) : null}
          {current?.is_sample ? (
            <div role="status" data-testid="sample-banner" className="tone-warning mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">Development sample.</strong> Every number on this page is computed on {int(current.meta.n_rows)} users (~
                {Math.round((current.meta.n_rows / current.meta.full_dataset_rows) * 100)}% of the {int(current.meta.full_dataset_rows)}-row dataset). These are not full-dataset results.
              </span>
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
