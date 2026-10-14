"use client";

import * as React from "react";
import Link from "next/link";
import { Compass, X } from "lucide-react";
import { Term } from "@/components/term";

const KEY = "experimentos.welcome-dismissed";
const STEPS = [
  { href: "/overview", title: "Did it work?", body: "The effect, with its uncertainty." },
  { href: "/diagnostics", title: "Can we trust it?", body: "Randomisation checks and segments." },
  { href: "/models", title: "Who responds?", body: "Targeting models tested on unseen users." },
  { href: "/simulator", title: "What should we do?", body: "Plug in your costs and see the decision." },
];

/** First-visit orientation. Dismissal is remembered in this browser. */
export function Welcome() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: fine to show again next time */
    }
  };
  return (
    <section className="relative rounded-lg border border-border bg-surface px-5 py-4" aria-label="How to use ExperimentOS" data-testid="welcome">
      <button onClick={dismiss} className="absolute right-3 top-3 rounded-md p-1 text-muted hover:bg-wash hover:text-foreground" aria-label="Dismiss the introduction">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Compass className="h-4 w-4 text-accent" aria-hidden /> New here? Follow one real experiment in four steps
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.href}>
            <Link href={s.href} className="flex h-full gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold tabular">{i + 1}</span>
              <span>
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-secondary">{s.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-secondary">
        Words with a dotted underline, like <Term k="uplift" />, show a plain-English definition when you hover or tap them.
      </p>
    </section>
  );
}
