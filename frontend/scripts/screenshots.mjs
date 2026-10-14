// Regenerates the README screenshots from the running app: `node scripts/screenshots.mjs [baseUrl]`.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ? process.argv[3].replace(/\/?$/, "/") : new URL("../../docs/images/", import.meta.url).pathname;
await mkdir(out, { recursive: true });

const shots = [
  { name: "insights", path: "/" },
  { name: "overview", path: "/overview" },
  { name: "diagnostics", path: "/diagnostics" },
  { name: "model-lab", path: "/models" },
  { name: "explainability", path: "/models", element: "[data-testid=explain-panel]" },
  { name: "simulator", path: "/simulator" },
  { name: "planner", path: "/planner" },
  { name: "sequential", path: "/sequential" },
  { name: "brief", path: "/brief" },
  { name: "sql", path: "/sql" },
  { name: "glossary", path: "/glossary" },
];

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
  await page.addInitScript(() => {
    localStorage.setItem("experimentos.scope", "full");
    localStorage.setItem("experimentos.welcome-dismissed", "1");
    localStorage.removeItem("experimentos.scenario");
  });
  for (const s of shots) {
    if (scheme === "dark" && !["insights", "simulator"].includes(s.name)) continue;
    await page.goto(base + s.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const file = `${out}${s.name}${scheme === "dark" ? "-dark" : ""}.png`;
    if (s.element) await page.locator(s.element).screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log("wrote", file);
  }
  await page.close();
}
// Phone view with the navigation drawer open.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" });
await phone.addInitScript(() => localStorage.setItem("experimentos.scope", "full"));
await phone.goto(base + "/simulator", { waitUntil: "networkidle" });
await phone.waitForTimeout(800);
await phone.screenshot({ path: `${out}mobile.png` });
await phone.getByTestId("menu-button").click();
await phone.waitForTimeout(400);
await phone.screenshot({ path: `${out}mobile-menu.png` });
console.log("wrote mobile screenshots");
await browser.close();
