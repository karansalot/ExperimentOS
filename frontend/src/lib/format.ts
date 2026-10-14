type N = number | null | undefined;
const ok = (x: N): x is number => typeof x === "number" && Number.isFinite(x);

export const int = (x: N) => (ok(x) ? Math.round(x).toLocaleString("en-US") : "–");
export const num = (x: N, d = 2) => (ok(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
export const pct = (x: N, d = 2) => (ok(x) ? `${(x * 100).toFixed(d)}%` : "–");
/** Percentage points, always signed. */
export const pp = (x: N, d = 3) => (ok(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)} pp` : "–");
export const signedPct = (x: N, d = 1) => (ok(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%` : "–");
export const compact = (x: N) =>
  ok(x) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x) : "–";
export const signedCompact = (x: N) => (ok(x) ? `${x < 0 ? "−" : x > 0 ? "+" : ""}${compact(Math.abs(x))}` : "–");
export const money = (x: N) => (ok(x) ? `${x < 0 ? "−" : ""}${Math.abs(Math.round(x)).toLocaleString("en-US")}` : "–");
export const pval = (p: N) => (!ok(p) ? "–" : p < 1e-4 ? "< 0.0001" : p.toFixed(4));
export const per1k = (x: N, d = 2) => (ok(x) ? (x * 1000).toFixed(d) : "–");

export const OUTCOME_LABEL: Record<string, string> = { visit: "Visit", conversion: "Conversion" };

export const MODEL_COLOR: Record<string, string> = {
  random: "var(--series-random)",
  response: "var(--series-response)",
  two_model_logit: "var(--series-two-model)",
  t_learner_gbm: "var(--series-t-learner)",
  s_learner_gbm: "var(--series-s-learner)",
};
export const MODEL_ORDER = ["t_learner_gbm", "response", "two_model_logit", "s_learner_gbm", "random"];
