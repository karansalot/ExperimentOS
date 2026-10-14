"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { DEFAULT_SCENARIO, type Scenario } from "@/lib/scenario";

type ScopeInfo = { name: string; label: string; is_sample: boolean; artifacts: string[]; meta: any };
type AppMeta = { dataset: any; scopes: ScopeInfo[]; default_scope: string; outcomes: string[]; features: string[]; risk_options: { id: string; label: string }[]; seed: number };

export type Theme = "system" | "light" | "dark";

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
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
const THEME_KEY = "experimentos.theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = React.useState<AppMeta | null>(null);
  const [metaError, setMetaError] = React.useState<string | null>(null);
  const [scope, setScopeState] = React.useState<string | null>(null);
  const [scenario, setScenarioState] = React.useState<Scenario>(DEFAULT_SCENARIO);
  const [theme, setThemeState] = React.useState<Theme>("system");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") {
      setThemeState(saved);
      // The inline script in <head> applies this before first paint; re-apply after hydration in case it was reset.
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    if (t === "system") {
      window.localStorage.removeItem(THEME_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      window.localStorage.setItem(THEME_KEY, t);
      document.documentElement.setAttribute("data-theme", t);
    }
  }, []);

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
    <AppContext.Provider value={{ theme, setTheme, meta, metaError, scope, setScope, scenario, setScenario, resetScenario }}>{children}</AppContext.Provider>
  );
}

export function useApp() {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <Providers>");
  return ctx;
}
