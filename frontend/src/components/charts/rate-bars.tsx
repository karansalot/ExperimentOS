"use client";

import { pct } from "@/lib/format";

/** Two-arm rate comparison. Bars are capped thin, share one baseline, and carry their value as text. */
export function RateBars({ title, control, treatment, digits = 2 }: { title: string; control: number; treatment: number; digits?: number }) {
  const max = Math.max(control, treatment) * 1.15 || 1;
  const rows = [
    { label: "Control", value: control, color: "var(--series-control)" },
    { label: "Treatment", value: treatment, color: "var(--series-treatment)" },
  ];
  return (
    <div role="img" aria-label={`${title}: control ${pct(control, digits)}, treatment ${pct(treatment, digits)}`}>
      <div className="mb-2 text-xs font-medium text-secondary">{title}</div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[72px_1fr_64px] items-center gap-2 text-xs" title={`${r.label}: ${pct(r.value, digits + 1)}`}>
            <span className="text-secondary">{r.label}</span>
            <div className="h-4 border-l border-[color:var(--axis)]">
              <div className="h-full rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
            </div>
            <span className="text-right font-medium tabular">{pct(r.value, digits)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
