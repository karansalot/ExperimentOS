"use client";

import * as React from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Legend } from "@/components/page";
import { MODEL_COLOR, MODEL_ORDER } from "@/lib/format";

export type CurveSeries = { id: string; name: string; values: number[]; low?: number[]; high?: number[] };

/**
 * Lines over "% of users targeted" for several strategies on one axis.
 * The highlighted strategy carries its interval as a light band; a crosshair tooltip reads out every series.
 */
export function CurveChart({
  x,
  series,
  highlight,
  yLabel,
  yFormat,
  tooltipFormat,
  markers = [],
  zeroLine = false,
  height = 320,
  ariaLabel,
}: {
  x: number[];
  series: CurveSeries[];
  highlight?: string;
  yLabel: string;
  yFormat: (v: number) => string;
  tooltipFormat?: (v: number) => string;
  markers?: { x: number; label: string }[];
  zeroLine?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const ordered = [...series].sort((a, b) => MODEL_ORDER.indexOf(a.id) - MODEL_ORDER.indexOf(b.id));
  const hi = ordered.find((s) => s.id === highlight && s.low && s.high);
  const data = x.map((xv, i) => {
    const row: Record<string, any> = { x: xv };
    for (const s of ordered) row[s.id] = s.values[i];
    if (hi) row.band = [hi.low![i], hi.high![i]];
    return row;
  });
  const names = Object.fromEntries(ordered.map((s) => [s.id, s.name]));

  return (
    <div>
      <Legend
        items={[
          ...ordered.map((s) => ({ label: s.name, color: MODEL_COLOR[s.id] ?? "var(--accent)", dashed: s.id === "random" })),
          ...(hi ? [{ label: `95% interval (${hi.name})`, color: MODEL_COLOR[hi.id], shape: "rect" as const }] : []),
        ]}
      />
      <div style={{ height }} className="mt-2" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 18, left: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" type="number" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={{ stroke: "var(--axis)" }}
              label={{ value: "Share of users targeted (highest score first)", position: "insideBottom", offset: -10 }} />
            <YAxis tickFormatter={yFormat} tickLine={false} axisLine={false} width={56} label={{ value: yLabel, angle: -90, position: "insideLeft", style: { textAnchor: "middle" }, offset: 4 }} />
            {zeroLine ? <ReferenceLine y={0} stroke="var(--axis)" /> : null}
            {markers.map((m) => (
              <ReferenceLine key={m.label} x={m.x} stroke="var(--text-muted)" label={{ value: m.label, position: "insideTopRight", fontSize: 10, fill: "var(--text-secondary)" }} />
            ))}
            {hi ? <Area dataKey="band" stroke="none" fill={MODEL_COLOR[hi.id]} fillOpacity={0.12} isAnimationActive={false} activeDot={false} /> : null}
            {ordered.map((s) => (
              <Line key={s.id} dataKey={s.id} name={s.name} stroke={MODEL_COLOR[s.id] ?? "var(--accent)"} strokeWidth={s.id === highlight ? 2.5 : 2}
                strokeDasharray={s.id === "random" ? "5 4" : undefined} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} strokeLinecap="round" />
            ))}
            <Tooltip cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }}
              content={<ChartTooltip title={(l) => `Top ${l}% targeted`} format={(v) => (tooltipFormat ?? yFormat)(v)} names={names} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
