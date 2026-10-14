"use client";

import * as React from "react";
import { Save, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { money, num } from "@/lib/format";
import type { Scenario } from "@/lib/scenario";

type Saved = {
  id: string;
  name: string;
  scope: string;
  is_sample: boolean;
  scenario: Scenario;
  strategy_name: string;
  coverage: number;
  incremental: number;
  cost: number;
  profit: number;
  profit_low: number;
  profit_high: number;
  recommended: string;
};

const KEY = "experimentos.saved-scenarios";

/** Snapshot scenarios (assumptions + headline results) in the browser and compare them side by side. */
export function SavedScenarios({ result, busy }: { result: any; busy: boolean }) {
  const { setScenario } = useApp();
  const [items, setItems] = React.useState<Saved[]>([]);
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    try {
      setItems(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"));
    } catch {
      setItems([]);
    }
  }, []);

  const persist = (next: Saved[]) => {
    setItems(next);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  };

  const save = () => {
    const s = result.scenario;
    const rec = result.recommendation;
    const { strategy_resolved, strategy_name, risk_criterion, ...scenario } = s;
    persist([
      ...items,
      {
        id: `${Date.now()}`,
        name: name.trim() || `Scenario ${items.length + 1}`,
        scope: result.meta.scope,
        is_sample: result.meta.is_sample,
        scenario,
        strategy_name,
        coverage: result.selected.targeting_pct,
        incremental: result.selected.incremental_outcomes,
        cost: result.selected.treatment_cost,
        profit: result.selected.profit,
        profit_low: result.selected.profit_low,
        profit_high: result.selected.profit_high,
        recommended: rec.action === "hold" ? "do not treat" : rec.action === "roll_out" ? "treat everyone" : `top ${rec.targeting_pct.toFixed(0)}%`,
      },
    ]);
    setName("");
  };

  const best = items.length > 1 ? Math.max(...items.map((i) => i.profit)) : null;

  return (
    <Card data-testid="saved-scenarios">
      <CardHeader>
        <CardTitle>Compare scenarios</CardTitle>
        <CardDescription>Snapshot the current assumptions and results, change the inputs, and compare. Snapshots are kept in this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="no-print flex flex-wrap items-center gap-2">
          <Input aria-label="Scenario name" data-testid="scenario-name" placeholder="Name this scenario (optional)" value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
          {/* Disabled while the simulator recomputes, so a snapshot can never pair new inputs with old results. */}
          <Button onClick={save} disabled={busy} data-testid="save-scenario"><Save className="h-4 w-4" aria-hidden /> Save current scenario</Button>
          {items.length ? <Button variant="ghost" size="sm" onClick={() => persist([])}>Clear all</Button> : null}
        </div>
        {items.length ? (
          <Table data-testid="saved-table">
            <THead>
              <TR>
                <TH>Scenario</TH><TH>Outcome</TH><TH>Strategy</TH><TH className="text-right">Cost / user</TH><TH className="text-right">Value / outcome</TH><TH className="text-right">Coverage</TH>
                <TH className="text-right">Incremental</TH><TH className="text-right">Cost</TH><TH className="text-right">Profit</TH><TH className="text-right">95% interval</TH><TH>Recommended</TH><TH><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id} className="tabular">
                  <TD>
                    <span className="font-medium">{i.name}</span>
                    {i.is_sample ? <Badge variant="warning" className="ml-2">dev sample</Badge> : null}
                    {best != null && i.profit === best ? <Badge variant="accent" className="ml-2">highest profit</Badge> : null}
                  </TD>
                  <TD>{i.scenario.outcome}</TD>
                  <TD className="text-secondary">{i.strategy_name}</TD>
                  <TD className="text-right">{num(i.scenario.cost_per_user, 2)}</TD>
                  <TD className="text-right">{num(i.scenario.value_per_outcome, 2)}</TD>
                  <TD className="text-right">{i.coverage.toFixed(0)}%</TD>
                  <TD className="text-right">{money(i.incremental)}</TD>
                  <TD className="text-right">{money(i.cost)}</TD>
                  <TD className="text-right font-medium">{money(i.profit)}</TD>
                  <TD className="text-right text-secondary">{money(i.profit_low)} to {money(i.profit_high)}</TD>
                  <TD>{i.recommended}</TD>
                  <TD className="no-print whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setScenario(i.scenario)} aria-label={`Load ${i.name}`}><Upload className="h-3.5 w-3.5" aria-hidden /> Load</Button>
                    <Button variant="ghost" size="sm" onClick={() => persist(items.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.name}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-muted">No scenarios saved yet. Save the current one, then change a cost, value or coverage and save again to compare.</p>
        )}
      </CardContent>
    </Card>
  );
}
