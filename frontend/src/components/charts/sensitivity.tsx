"use client";

import { money, signedCompact } from "@/lib/format";

const mix = (v: number, max: number) => {
  if (!max || v === 0) return "var(--div-mid)";
  const share = Math.round(Math.min(1, Math.abs(v) / max) * 65) + 8;
  return `color-mix(in srgb, ${v > 0 ? "var(--div-pos)" : "var(--div-neg)"} ${share}%, var(--div-mid))`;
};

/** Profit across cost x value multipliers. Diverging colour around zero profit; every cell prints its value. */
export function SensitivityHeatmap({ multipliers, grid, baseCost, baseValue, field }: { multipliers: number[]; grid: any[][]; baseCost: number; baseValue: number; field: "profit_at_selected" | "profit_at_optimum" }) {
  const max = Math.max(...grid.flat().map((c) => Math.abs(c[field])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate text-xs tabular" style={{ borderSpacing: 2 }} data-testid="sensitivity-heatmap">
        <caption className="sr-only">Scenario profit by treatment cost (rows) and value per incremental outcome (columns)</caption>
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-muted">Cost per user ↓ · Value per outcome →</th>
            {multipliers.map((m) => (
              <th key={m} className="px-2 py-1 text-right font-medium text-secondary">
                {(baseValue * m).toFixed(2)}
                <span className="block text-[10px] font-normal text-muted">{m}×</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, i) => (
            <tr key={multipliers[i]}>
              <th className="whitespace-nowrap px-2 py-1 text-left font-medium text-secondary">
                {(baseCost * multipliers[i]).toFixed(3)} <span className="text-[10px] font-normal text-muted">{multipliers[i]}×</span>
              </th>
              {row.map((cell, j) => {
                const isBase = multipliers[i] === 1 && multipliers[j] === 1;
                return (
                  <td
                    key={j}
                    className="rounded-[4px] px-2 py-2 text-right text-foreground"
                    style={{ background: mix(cell[field], max), outline: isBase ? "2px solid var(--text-primary)" : undefined, outlineOffset: -2 }}
                    title={`Cost ${(baseCost * multipliers[i]).toFixed(3)}, value ${(baseValue * multipliers[j]).toFixed(2)}: profit ${money(cell[field])}${field === "profit_at_optimum" ? ` at ${cell.optimal_targeting_pct.toFixed(0)}% targeted` : ""}`}
                  >
                    {signedCompact(cell[field])}
                    {field === "profit_at_optimum" ? <span className="block text-[10px] text-secondary">{cell.optimal_targeting_pct.toFixed(0)}%</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--div-neg)" }} />Loss</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--div-mid)" }} />Break-even</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--div-pos)" }} />Profit</span>
        <span>Outlined cell = your current assumptions.</span>
      </div>
    </div>
  );
}

/** One-at-a-time swings in profit around the base case, widest first. */
export function Tornado({ rows, base }: { rows: any[]; base: number }) {
  const lo = Math.min(base, ...rows.map((r) => Math.min(r.profit_unfavourable, r.profit_favourable)));
  const hi = Math.max(base, ...rows.map((r) => Math.max(r.profit_unfavourable, r.profit_favourable)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="flex flex-col gap-3" data-testid="tornado">
      {rows.map((r) => {
        const a = pos(r.profit_unfavourable);
        const b = pos(r.profit_favourable);
        const c = pos(base);
        return (
          <div key={r.driver} title={`${r.driver} (${r.change}): ${money(r.profit_unfavourable)} to ${money(r.profit_favourable)}`}>
            <div className="mb-1 flex justify-between gap-3 text-xs">
              <span className="text-secondary">{r.driver} <span className="text-muted">({r.change})</span></span>
              <span className="whitespace-nowrap font-medium tabular">{money(r.profit_unfavourable)} to {money(r.profit_favourable)}</span>
            </div>
            <div className="relative h-4">
              <div className="absolute inset-y-0 rounded-l-[4px]" style={{ left: `${Math.min(a, c)}%`, width: `${Math.max(0, Math.abs(c - a) - 0.3)}%`, background: "var(--div-neg)" }} />
              <div className="absolute inset-y-0 rounded-r-[4px]" style={{ left: `${Math.min(b, c) + 0.3}%`, width: `${Math.max(0, Math.abs(b - c) - 0.3)}%`, background: "var(--div-pos)" }} />
              <div className="absolute -inset-y-1 w-px bg-[color:var(--text-primary)]" style={{ left: `${c}%` }} />
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 text-[11px] text-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--div-neg)" }} />Unfavourable</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--div-pos)" }} />Favourable</span>
        <span>Vertical line = base-case profit {money(base)}.</span>
      </div>
    </div>
  );
}
