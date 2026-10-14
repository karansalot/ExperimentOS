"use client";

import { Bar, CartesianGrid, ComposedChart, ErrorBar, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Legend } from "@/components/page";

/** Predicted vs observed uplift by decile of predicted uplift (decile 1 = highest predictions). */
export function CalibrationChart({ rows, basis, color }: { rows: any[]; basis: string; color: string }) {
  const adj = basis === "adjusted" && rows[0]?.observed_uplift_adjusted != null;
  const data = rows.map((r) => {
    const obs = adj ? r.observed_uplift_adjusted : r.observed_uplift;
    const se = adj ? r.observed_adjusted_std_error : r.observed_std_error;
    return { group: r.group, observed: obs * 100, err: 1.96 * se * 100, predicted: r.mean_predicted_uplift * 100 };
  });
  return (
    <div>
      <Legend items={[{ label: "Observed uplift (95% CI)", color, shape: "rect" }, { label: "Mean predicted uplift", color: "var(--text-primary)", shape: "dot" }]} />
      <div className="mt-2 h-[280px]" role="img" aria-label="Predicted versus observed uplift by decile">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="group" tickLine={false} axisLine={{ stroke: "var(--axis)" }} label={{ value: "Decile of predicted uplift (1 = highest)", position: "insideBottom", offset: -10 }} />
            <YAxis tickFormatter={(v) => `${v.toFixed(1)}`} tickLine={false} axisLine={false} width={48} label={{ value: "Uplift (pp)", angle: -90, position: "insideLeft", style: { textAnchor: "middle" } }} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Bar dataKey="observed" name="Observed uplift" fill={color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <ErrorBar dataKey="err" width={6} strokeWidth={1.5} stroke="var(--text-secondary)" />
            </Bar>
            <Scatter dataKey="predicted" name="Mean predicted uplift" fill="var(--text-primary)" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
            <Tooltip cursor={{ fill: "var(--accent-soft)", opacity: 0.3 }} content={<ChartTooltip title={(l) => `Decile ${l}`} format={(v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)} pp`} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
