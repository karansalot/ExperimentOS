"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { useApp } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { OUTCOME_LABEL } from "@/lib/format";
import type { Scenario } from "@/lib/scenario";

const STRATEGIES = [
  ["champion", "Champion uplift model"],
  ["s_learner_gbm", "S-learner (gradient boosting)"],
  ["t_learner_gbm", "T-learner (gradient boosting)"],
  ["two_model_logit", "Two-model (logistic)"],
  ["response", "Response propensity baseline"],
  ["random", "Random targeting baseline"],
];

function NumberField({ id, label, hint, value, onChange, step, min = 0, placeholder }: { id: string; label: string; hint?: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; placeholder?: string }) {
  const [text, setText] = React.useState(value == null ? "" : String(value));
  React.useEffect(() => {
    setText((t) => (t !== "" && Number(t) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        data-testid={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === "") onChange(null);
          else if (Number.isFinite(Number(e.target.value)) && Number(e.target.value) >= min) onChange(Number(e.target.value));
        }}
      />
    </Field>
  );
}

const PRESETS: { label: string; hint: string; patch: Partial<Scenario> }[] = [
  { label: "Cheap display ad", hint: "0.02 per user, 3 per visit", patch: { outcome: "visit", cost_per_user: 0.02, value_per_outcome: 3, budget: null, risk: "moderate" } },
  { label: "Premium placement", hint: "0.20 per user, 8 per visit", patch: { outcome: "visit", cost_per_user: 0.2, value_per_outcome: 8, budget: null, risk: "moderate" } },
  { label: "Tight budget", hint: "budget capped at 5,000", patch: { outcome: "visit", cost_per_user: 0.05, value_per_outcome: 5, budget: 5000 } },
  { label: "Conversion campaign", hint: "40 per conversion", patch: { outcome: "conversion", cost_per_user: 0.05, value_per_outcome: 40, budget: null } },
  { label: "Play it safe", hint: "optimise a bad-case outcome", patch: { risk: "conservative" } },
];

export function ScenarioForm() {
  const { scenario: s, setScenario, resetScenario, meta } = useApp();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-xs font-medium text-secondary">Quick start</div>
        <div className="flex flex-wrap gap-1.5" data-testid="presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              title={p.hint}
              onClick={() => setScenario(p.patch)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-secondary transition-colors hover:bg-wash hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Outcome to value" htmlFor="sc-outcome">
        <Select id="sc-outcome" data-testid="sc-outcome" value={s.outcome} onChange={(e) => setScenario({ outcome: e.target.value })}>
          {(meta?.outcomes ?? ["visit", "conversion"]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </Select>
      </Field>
      <Field label="Targeting strategy" htmlFor="sc-strategy">
        <Select id="sc-strategy" data-testid="sc-strategy" value={s.strategy} onChange={(e) => setScenario({ strategy: e.target.value })}>
          {STRATEGIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
      </Field>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs font-medium text-secondary">Treatment coverage</span>
          <span className="text-sm font-semibold tabular" data-testid="sc-targeting-value">{s.targeting_pct}% of users</span>
        </div>
        <Slider label="Treatment coverage" min={0} max={100} step={1} value={[s.targeting_pct]} onValueChange={([v]) => setScenario({ targeting_pct: v })} data-testid="sc-targeting" />
      </div>
      <NumberField id="sc-population" label="Population size" value={s.population} min={1} step={1000} onChange={(v) => v && setScenario({ population: Math.round(v) })} hint="Users you could treat. Test-split effects are scaled linearly to this size." />
      <NumberField id="sc-cost" label="Treatment cost per targeted user" value={s.cost_per_user} step={0.01} onChange={(v) => v != null && setScenario({ cost_per_user: v })} hint="Your assumption, in any currency." />
      <NumberField id="sc-value" label={`Value per incremental ${s.outcome}`} value={s.value_per_outcome} step={0.5} onChange={(v) => v != null && setScenario({ value_per_outcome: v })} hint="Your assumption, same currency." />
      <NumberField id="sc-budget" label="Budget cap (optional)" value={s.budget} step={1000} placeholder="No cap" onChange={(v) => setScenario({ budget: v })} hint="Total treatment spend allowed." />
      <Field label="Risk tolerance" htmlFor="sc-risk" hint="What the recommended depth optimises.">
        <Select id="sc-risk" data-testid="sc-risk" value={s.risk} onChange={(e) => setScenario({ risk: e.target.value })}>
          <option value="conservative">Conservative: 10th-percentile profit</option>
          <option value="moderate">Moderate: 25th-percentile profit</option>
          <option value="neutral">Risk-neutral: expected profit</option>
        </Select>
      </Field>
      <Field label="Effect estimate basis" htmlFor="sc-basis" hint="Adjusted corrects for feature imbalance between arms and is the more cautious choice here.">
        <Select id="sc-basis" data-testid="sc-basis" value={s.basis} onChange={(e) => setScenario({ basis: e.target.value })}>
          <option value="adjusted">Covariate-adjusted (doubly robust)</option>
          <option value="unadjusted">Unadjusted</option>
        </Select>
      </Field>
      <Button variant="outline" size="sm" onClick={resetScenario} className="self-start">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset assumptions
      </Button>
    </div>
  );
}

/** Debounced POST of the shared scenario to an API endpoint. */
export function useScenarioResult<T = any>(path: "/simulate" | "/brief") {
  const { scenario, scope } = useApp();
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const body = JSON.stringify(scenario);

  React.useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const json = await api<T>(`${path}?scope=${scope}`, { method: "POST", body });
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [body, scope, path]);

  return { data, error, loading };
}
