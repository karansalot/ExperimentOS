"use client";

import * as React from "react";

export type ForestRow = {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  low?: number | null;
  high?: number | null;
  color?: string;
  muted?: boolean;
};

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0); // 0 until measured, so the SVG can never set its own container's width
  // Measure synchronously on mount (a ResizeObserver callback waits for a rendered frame), then track resizes.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, w] as const;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 1) ?? mag * 10;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return out;
}

/**
 * Dot-and-whisker plot of estimates with confidence intervals on one shared axis.
 * Values are also printed as text on each row, so nothing depends on hover.
 */
export function ForestPlot({
  rows,
  format,
  tickFormat,
  references = [],
  labelWidth = 170,
  valueWidth = 190,
  ariaLabel,
}: {
  rows: ForestRow[];
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  references?: { value: number; label?: string }[];
  labelWidth?: number;
  valueWidth?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<string | null>(null);
  const compact = width < 560;
  const lw = compact ? 110 : labelWidth;
  const vw = compact ? 0 : valueWidth;
  const rowH = 30;
  const top = 6;
  const axisH = 26;
  const plotL = lw + 8;
  const plotR = width - vw - 12;
  const all = rows.flatMap((r) => [r.value, r.low ?? r.value, r.high ?? r.value]).concat(references.map((r) => r.value), [0]);
  let min = Math.min(...all);
  let max = Math.max(...all);
  const pad = (max - min || Math.abs(max) || 1) * 0.08;
  min -= min < 0 ? pad : 0;
  max += pad;
  const x = (v: number) => plotL + ((v - min) / (max - min)) * (plotR - plotL);
  const ticks = niceTicks(min, max, compact ? 3 : 5);
  const height = top + rows.length * rowH + axisH;
  const tf = tickFormat ?? format;

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden" style={{ minHeight: height }}>
      {width > 0 ? (
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={top + rows.length * rowH} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={x(t)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {tf(t)}
            </text>
          </g>
        ))}
        {references.map((r) => (
          <g key={`ref-${r.value}`}>
            <line x1={x(r.value)} x2={x(r.value)} y1={top} y2={top + rows.length * rowH} stroke="var(--text-muted)" strokeWidth={1} />
            {r.label ? (
              <text x={x(r.value)} y={top + 9} dx={4} fontSize={10} fill="var(--text-muted)">
                {r.label}
              </text>
            ) : null}
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          const color = r.color ?? "var(--accent)";
          const hasCI = r.low != null && r.high != null;
          const text = hasCI ? `${format(r.value)}  [${format(r.low!)}, ${format(r.high!)}]` : format(r.value);
          return (
            <g
              key={r.key}
              tabIndex={0}
              onPointerEnter={() => setHover(r.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(r.key)}
              onBlur={() => setHover(null)}
              style={{ outline: "none" }}
            >
              <title>{`${r.label}${r.sublabel ? ` (${r.sublabel})` : ""}: ${text}`}</title>
              <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill={hover === r.key ? "var(--accent-soft)" : "transparent"} opacity={0.35} />
              <text x={lw} y={cy - (r.sublabel ? 3 : -4)} textAnchor="end" fontSize={12} fill={r.muted ? "var(--text-muted)" : "var(--text-primary)"}>
                {r.label}
              </text>
              {r.sublabel ? (
                <text x={lw} y={cy + 10} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                  {r.sublabel}
                </text>
              ) : null}
              {hasCI ? (
                <line x1={x(r.low!)} x2={x(r.high!)} y1={cy} y2={cy} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={r.muted ? 0.45 : 1} />
              ) : (
                <line x1={x(0)} x2={x(r.value)} y1={cy} y2={cy} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={r.muted ? 0.45 : 1} />
              )}
              <circle cx={x(r.value)} cy={cy} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} opacity={r.muted ? 0.55 : 1} />
              {vw ? (
                <text x={width} y={cy + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {text}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      ) : null}
    </div>
  );
}
