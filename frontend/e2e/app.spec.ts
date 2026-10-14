import { expect, test, type Page } from "@playwright/test";

const FULL_ROWS = "13,979,592";

async function useScope(page: Page, scope: "full" | "dev_sample") {
  await page.addInitScript((s) => {
    window.localStorage.setItem("experimentos.scope", s);
    window.localStorage.removeItem("experimentos.scenario");
  }, scope);
}

test.describe("full dataset", () => {
  test.beforeEach(async ({ page }) => useScope(page, "full"));

  test("insights landing leads with evidence-linked findings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("scope-badge")).toContainText(`Full dataset · ${FULL_ROWS} users`);
    await expect(page.getByTestId("hero")).toContainText("covariate-adjusted");
    const cards = page.getByTestId("insight-grid").locator("a");
    expect(await cards.count()).toBeGreaterThanOrEqual(8);
    for (const id of ["effect", "inflation", "concentration", "heterogeneity", "peeking", "file_order"]) {
      await expect(page.getByTestId(`insight-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("concentration-chart").locator("path.recharts-line-curve")).toHaveCount(3);
    await page.getByTestId("insight-inflation").click();
    await expect(page).toHaveURL(/\/diagnostics\/?$/);
    await expect(page.getByTestId("variance-reduction")).toContainText("larger unadjusted experiment");
  });

  test("sequential lab shows the cost of peeking and boundaries that fix it", async ({ page }) => {
    await page.goto("/sequential");
    await expect(page.getByTestId("tile-naive-fpr")).toContainText("%");
    const naive = parseFloat((await page.getByTestId("tile-naive-fpr").innerText()).match(/([\d.]+)%/)![1]);
    const obf = parseFloat((await page.getByTestId("tile-obf-fpr").innerText()).match(/([\d.]+)%/)![1]);
    expect(naive).toBeGreaterThan(15); // 10 looks inflate a 5% test to ~19%
    expect(obf).toBeLessThan(6.5);
    await expect(page.getByTestId("sequential-table").locator("tbody tr")).toHaveCount(3);
    await expect(page.getByTestId("boundary-chart").locator("path.recharts-line-curve")).toHaveCount(3);
  });

  test("overview reports verified full-dataset figures with uncertainty", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByTestId("scope-badge")).toContainText(`Full dataset · ${FULL_ROWS} users`);
    await expect(page.getByTestId("sample-banner")).toHaveCount(0);
    await expect(page.getByTestId("tile-users")).toContainText(FULL_ROWS);
    for (const o of ["visit", "conversion"]) {
      const tile = page.getByTestId(`tile-effect-${o}`);
      await expect(tile).toContainText("pp");
      await expect(tile).toContainText("95% CI");
    }
    await expect(page.getByTestId("srm-callout")).toContainText("Sample ratio matches the design");
    await expect(page.getByTestId("balance-callout")).toBeVisible();
    await expect(page.getByTestId("adjusted-note-visit")).toContainText("covariate-adjusted estimate");
    await expect(page.getByRole("img", { name: /treatment effect by estimator/i })).toBeVisible();
    await expect(page.getByTestId("bayes-card")).toContainText("P(treatment better)");
    await expect(page.getByTestId("bayes-card")).toContainText("> 99.99%");
  });

  test("diagnostics show balance, SRM and segment comparisons with adjusted p-values", async ({ page }) => {
    await page.goto("/diagnostics");
    await expect(page.getByTestId("balance-verdict")).toBeVisible();
    await expect(page.getByTestId("tile-srm")).toContainText("None");
    await expect(page.getByTestId("tile-c2st")).toContainText("0.5");
    await expect(page.getByRole("img", { name: /standardised mean difference/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "p (BH)" })).toBeVisible();
    const before = await page.getByRole("img", { name: /effect by f0 segment/i }).getAttribute("aria-label");
    await page.getByTestId("segment-feature").selectOption("f8");
    await expect(page.getByRole("img", { name: /effect by f8 segment/i })).toBeVisible();
    expect(before).toContain("f0");
  });

  test("model lab compares five strategies and draws uplift curves", async ({ page }) => {
    await page.goto("/models");
    const rows = page.getByTestId("model-table").locator("tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId("model-table").getByText("champion", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("champion-callout")).toContainText("Champion for visit");
    await expect(page.getByTestId("run-status")).toHaveText("completed");
    // one line per strategy in the cumulative uplift chart
    await expect(page.getByTestId("uplift-chart").locator("path.recharts-line-curve")).toHaveCount(5);
    await page.getByRole("tab", { name: "Qini" }).click();
    await expect(page.getByRole("img", { name: /Qini curves/i })).toBeVisible();
    await expect(page.getByTestId("importance-bars")).toBeVisible();
    await expect(page.getByTestId("agreement-chart").locator(".recharts-scatter-symbol").first()).toBeVisible();
    await expect(page.getByTestId("persuadables-table").locator("tbody tr")).toHaveCount(8);
    await page.getByTestId("model-outcome").selectOption("conversion");
    await expect(page.getByTestId("champion-callout")).toContainText("Champion for conversion");
  });

  test("simulator recomputes economics from assumptions and labels them as scenarios", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.getByTestId("scenario-disclaimer")).toContainText("Scenario estimates");
    const profit = page.getByTestId("tile-profit");
    await expect(profit).toContainText("95% interval");
    await expect(profit).toContainText("ROI");

    await page.getByTestId("sc-cost").fill("0.5");
    await expect(page.getByTestId("tile-cost")).toContainText("100,000"); // 20% of 1,000,000 users at 0.5
    await expect(profit).not.toContainText("ROI 2"); // the default scenario's ROI (in the 200s %) no longer holds

    await page.getByTestId("sc-budget").fill("25000");
    await expect(page.getByTestId("budget-callout")).toContainText("Budget caps coverage at 5%");
    await expect(page.getByTestId("tile-treated")).toContainText("5% coverage");
    await expect(page.getByTestId("tile-cost")).toContainText("25,000");

    await expect(page.getByTestId("strategy-table").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("break-even")).toContainText("Required effect per treated user");
    await expect(page.getByTestId("sensitivity-heatmap").locator("tbody td")).toHaveCount(36);
    await expect(page.getByTestId("tornado")).toBeVisible();
  });

  test("an unprofitable scenario recommends not treating", async ({ page }) => {
    await page.goto("/simulator");
    await page.getByTestId("sc-cost").fill("500");
    await expect(page.getByTestId("recommendation")).toContainText("do not treat");
  });

  test("simulator states a deployable rule and compares saved scenarios", async ({ page }) => {
    await page.goto("/simulator");
    await page.evaluate(() => window.localStorage.removeItem("experimentos.saved-scenarios"));
    await page.reload();
    await expect(page.getByTestId("targeting-rule")).toContainText("predicted uplift is at least");
    await expect(page.getByTestId("recommendation")).toContainText("chosen on the validation split");

    await page.getByTestId("scenario-name").fill("Baseline");
    await page.getByTestId("save-scenario").click();
    await page.getByTestId("sc-cost").fill("0.2");
    await expect(page.getByTestId("tile-cost")).toContainText("40,000"); // 20% of 1,000,000 users at 0.2
    await page.getByTestId("scenario-name").fill("Expensive channel");
    await page.getByTestId("save-scenario").click();

    const rows = page.getByTestId("saved-table").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Baseline");
    await expect(rows.nth(0)).toContainText("highest profit");
    await expect(rows.nth(1)).toContainText("0.20");
    await rows.nth(0).getByRole("button", { name: "Load Baseline" }).click();
    await expect(page.getByTestId("sc-cost")).toHaveValue("0.05");
    await page.reload();
    await expect(page.getByTestId("saved-table").locator("tbody tr")).toHaveCount(2); // persisted in the browser
  });

  test("diagnostics offer covariate-adjusted segment effects", async ({ page }) => {
    await page.goto("/diagnostics");
    await expect(page.getByRole("columnheader", { name: "Adjusted effect" })).toBeVisible();
    await expect(page.getByTestId("segment-axis-note")).toContainText("unadjusted");
    await page.getByTestId("segment-basis").selectOption("adjusted");
    await expect(page.getByTestId("segment-axis-note")).toContainText("covariate-adjusted");
  });

  test("experiment planner sizes a test and prices the allocation", async ({ page }) => {
    await page.goto("/planner");
    await expect(page.getByTestId("tile-required")).toContainText("in total");
    await expect(page.getByTestId("tile-allocation-cost")).toContainText("1.00×"); // default is a 50/50 split
    await expect(page.getByTestId("tile-required")).toContainText("323,"); // 5% lift on a 3.82% baseline, 50/50
    await page.getByTestId("pl-mde").fill("10");
    await expect(page.getByTestId("tile-required")).toContainText("82,"); // a larger lift needs about a quarter of the users
    await page.getByTestId("pl-daily").fill("50000");
    await expect(page.getByTestId("tile-duration")).toContainText("days");
    await expect(page.getByTestId("allocation-table").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("allocation-table")).toContainText("Criteo design");
    await expect(page.getByTestId("power-chart").locator("path.recharts-line-curve")).toHaveCount(1);
    await expect(page.getByTestId("observed-design")).toContainText("Minimum detectable effect");
    await page.getByTestId("pl-base").fill("150");
    await expect(page.getByRole("alert")).toBeVisible(); // invalid input is reported, last valid result stays on screen
    await expect(page.getByTestId("tile-required")).toBeVisible();
  });

  test("decision brief follows the simulator scenario and exports Markdown", async ({ page }) => {
    await page.goto("/simulator");
    await page.getByTestId("sc-value").fill("8");
    await expect(page.getByTestId("tile-profit")).toBeVisible();
    await page.getByRole("link", { name: "Open decision brief" }).click();
    await expect(page.getByTestId("brief-decision")).toBeVisible();
    await expect(page.getByTestId("brief")).toContainText("8.00");
    for (const id of ["findings", "interpretation", "recommendation", "limitations"]) {
      await expect(page.getByTestId(`brief-${id}`).locator("li").first()).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-brief").click()]);
    expect(download.suggestedFilename()).toBe("experimentos-decision-brief-full.md");
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString();
    expect(text).toContain("# ExperimentOS decision brief");
    expect(text).toContain("## Limitations");
    expect(text).toContain(FULL_ROWS);
  });

  test("SQL lab lists at least 15 queries and shows their text and results", async ({ page }) => {
    await page.goto("/sql");
    const items = page.getByTestId("query-list").locator("li");
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(15);
    await expect(page.getByTestId("dq-checks").locator("tbody tr").first()).toBeVisible();
    await expect(page.getByTestId("dq-checks").getByText("Fail")).toHaveCount(0);
    await items.filter({ hasText: "Sample ratio mismatch" }).click();
    await expect(page.getByTestId("query-sql")).toContainText("chi_square");
    await expect(page.getByTestId("query-detail").locator("tbody tr")).toHaveCount(2);
  });

  test("the browser never receives row-level data", async ({ page }) => {
    const sizes: number[] = [];
    page.on("response", async (res) => {
      // Python API responses, or the static export's data files in the hosted build
      if (res.url().includes("/api/") || res.url().includes("/data/")) sizes.push((await res.body().catch(() => Buffer.alloc(0))).length);
    });
    for (const path of ["/", "/overview", "/diagnostics", "/models", "/simulator", "/brief", "/planner", "/sequential", "/sql"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(sizes.length).toBeGreaterThan(8);
    expect(Math.max(...sizes)).toBeLessThan(500_000); // aggregates only (largest: one bootstrap array), for a 14M-row dataset
  });
});

test.describe("usability", () => {
  test.beforeEach(async ({ page }) => useScope(page, "full"));

  test("every analysis page explains itself in plain English and points to the next step", async ({ page }) => {
    for (const path of ["/overview", "/diagnostics", "/models", "/simulator", "/planner", "/sequential", "/sql"]) {
      await page.goto(path);
      await expect(page.getByTestId("plain-english").locator("li").first()).toBeVisible();
      await expect(page.getByTestId("next-step")).toBeVisible();
    }
  });

  test("glossary terms show definitions and the glossary is searchable", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("button", { name: /Percentage point.*definition/ }).first().hover();
    await expect(page.getByText("The difference between two percentages")).toBeVisible();
    await page.goto("/glossary");
    await page.getByTestId("glossary-search").fill("peeking");
    await expect(page.getByTestId("glossary-list").locator("dt")).toHaveCount(1);
  });

  test("theme switch overrides the system setting and persists", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "System theme" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  });

  test("simulator presets fill in assumptions", async ({ page }) => {
    await page.goto("/simulator");
    await page.getByTestId("presets").getByRole("button", { name: "Tight budget" }).click();
    await expect(page.getByTestId("sc-budget")).toHaveValue("5000");
    await expect(page.getByTestId("budget-callout")).toBeVisible();
    await page.getByTestId("presets").getByRole("button", { name: "Conversion campaign" }).click();
    await expect(page.getByTestId("sc-outcome")).toHaveValue("conversion");
  });

  test("tables download as CSV", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.getByTestId("strategy-table")).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download strategy-comparison.csv" }).click()]);
    expect(dl.suggestedFilename()).toBe("strategy-comparison.csv");
    let text = "";
    for await (const chunk of await dl.createReadStream()) text += chunk.toString();
    expect(text.split("\n")[0]).toContain("strategy,coverage_pct");
    expect(text.split("\n").length).toBe(8);
  });

  test("works on a phone: menu opens and the page never scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/overview", "/simulator", "/models"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    }
    await page.getByTestId("menu-button").click();
    await page.getByRole("link", { name: "Experiment planner" }).click();
    await expect(page).toHaveURL(/\/planner\/?$/);
  });

  test("first-visit guide can be dismissed", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("experimentos.welcome-dismissed"));
    await page.reload();
    await expect(page.getByTestId("welcome")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss the introduction" }).click();
    await page.reload();
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("welcome")).toHaveCount(0);
  });
});

test.describe("development sample", () => {
  test("is labelled as a sample everywhere it is shown", async ({ page }) => {
    await useScope(page, "dev_sample");
    for (const path of ["/", "/overview", "/diagnostics", "/models", "/simulator", "/brief", "/planner"]) {
      await page.goto(path);
      await expect(page.getByTestId("sample-banner")).toContainText("not full-dataset results");
      await expect(page.getByTestId("scope-badge")).toContainText("Development sample");
      await expect(page.getByTestId("scope-badge")).not.toContainText(FULL_ROWS);
    }
  });

  test("scope can be switched from the sidebar", async ({ page }) => {
    await useScope(page, "full");
    await page.goto("/");
    await expect(page.getByTestId("scope-badge")).toContainText("Full dataset");
    await page.getByTestId("scope-select").selectOption("dev_sample");
    await expect(page.getByTestId("sample-banner")).toBeVisible();
    await expect(page.getByTestId("scope-badge")).toContainText("Development sample");
  });
});
