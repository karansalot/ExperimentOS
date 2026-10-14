"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { DEFAULT_SCENARIO, type Scenario } from "@/lib/scenario";

type ScopeInfo = { name: string; label: string; is_sample: boolean; artifacts: string[]; meta: any };
type AppMeta = { dataset: any; scopes: ScopeInfo[]; default_scope: string; outcomes: string[]; features: string[]; risk_options: { id: string; label: string }[]; seed: number };

type Ctx = {
  meta: AppMeta | null;
  metaError: string | null;
  scope: string | null;
  setScope: (s: string) => void;
  scenario: Scenario;
  setScenario: (patch: Partial<Scenario>) => void;
  resetScenario: () => void;
};

const AppContext = React.createContext<Ctx | null>(null);
const SCOPE_KEY = "experimentos.scope";
const SCENARIO_KEY = "experimentos.scenario";

export function Providers({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = React.useState<AppMeta | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);
  const [scope, setScopeState] = React.useState<string | null>(null);
  const [scenario, setScenarioState] = React.useState<Scenario>(DEFAULT_SCENARIO);

  React.useEffect(() => {
    api<AppMeta>("/meta")
      .then((m) => {
        setMeta(m);
        const saved = window.localStorage.getItem(SCOPE_KEY);
        setScopeState(saved && m.scopes.some((s) => s.name === saved) ? saved : m.default_scope);
      })
      .catch((e: Error) => setMetaError(e.message));
    try {
      const saved = window.localStorage.getItem(SCENARIO_KEY);
      if (saved) setScenarioState({ ...DEFAULT_SCENARIO, ...JSON.parse(saved) });
    } catch {
      /* ignore a corrupt saved scenario */
    }
  }, []);

  const setScope = React.useCallback((s: string) => {
    setScopeState(s);
    window.localStorage.setItem(SCOPE_KEY, s);
  }, []);

  const setScenario = React.useCallback((patch: Partial<Scenario>) => {
    setScenarioState((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(SCENARIO_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetScenario = React.useCallback(() => {
    setScenarioState(DEFAULT_SCENARIO);
    window.localStorage.removeItem(SCENARIO_KEY);
  }, []);

  return (
    <AppContext.Provider value={{ meta, metaError, scope, setScope, scenario, setScenario, resetScenario }}>{children}</AppContext.Provider>
  );
}

export function useApp() {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <Providers>");
  return ctx;
}
