export type Scenario = {
  outcome: string;
  strategy: string;
  population: number;
  cost_per_user: number;
  value_per_outcome: number;
  targeting_pct: number;
  budget: number | null;
  risk: string;
  basis: string;
};

/** Illustrative defaults. They are assumptions for the user to replace, not values from the dataset. */
export const DEFAULT_SCENARIO: Scenario = {
  outcome: "visit",
  strategy: "champion",
  population: 1_000_000,
  cost_per_user: 0.05,
  value_per_outcome: 5,
  targeting_pct: 20,
  budget: null,
  risk: "moderate",
  basis: "adjusted",
};
