"use client";

import * as React from "react";

/** Shared Recharts tooltip: values lead, series names follow, line keys instead of boxes. */
export function ChartTooltip({
  active,
  payload,
  label,
  title,
  format,
  names,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  title: (label: any) => string;
  format: (v: number, key: string) => string;
  names?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === "number" && !String(p.dataKey).startsWith("band"));
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-secondary">{title(label)}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <svg width="12" height="6" aria-hidden>
              <line x1="0" y1="3" x2="12" y2="3" stroke={p.color ?? p.stroke ?? p.fill} strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="font-semibold tabular text-foreground">{format(p.value, String(p.dataKey))}</span>
            <span className="text-secondary">{names?.[String(p.dataKey)] ?? p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
